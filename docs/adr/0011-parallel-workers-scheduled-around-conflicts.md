# Parallel workers, scheduled around conflicts

Status: Proposed

The loop runs one worker at a time. That is the right default while the process is still being proven, but it caps throughput, and the roadmap's CI-native mode keeps a single-worker concurrency group for the same reason. `depends_on` orders tickets; nothing decides which tickets may run side by side. Whether two tickets are safe together is a decision, so it must be a tested function and not a worker's guess (ADR 0002).

## What the single worker rests on

Evidence from the engine, to show what N workers would break:

- `plugins/forger/engine/src/loop/lock.ts`: the engine lock is one file holding one pid. `decideLock` refuses a second engine while the holder is alive. The lock exists because two engines on one repo re-run the same ticket.
- `plugins/forger/engine/src/loop/state.ts`: `AutomationState` is one record with one `current_task`, one `session_id`, one `snapshot` and one `stall_count`. The HALT file is one file.
- `plugins/forger/engine/src/backlog/github-backlog.ts`: `blockedBy` is read into `depends_on`, and priority ties break by issue number. Nothing in the pick looks at what a ticket touches.
- `plugins/forger/engine/src/cli/loop.ts`: `status` reports one engine pid and its liveness.
- The claim (assigning the issue) already stops two sessions taking the same issue, so the claim is the one piece that is already safe for N.

## 1. What makes two tickets safe together

Three facts, each available before a worker starts:

- **Order.** `depends_on` (the issue's native blocked-by), followed transitively. A ticket whose blocker is not yet merged is never a candidate at all; two tickets where one blocks the other are never together.
- **Footprint.** The paths a ticket is expected to touch. Source: the ticket's `Knock-on` section (every ticket carries one by the template), parsed to paths by a pure function. A ticket with no parsable footprint has an unknown footprint.
- **Folder map.** `.claude/architecture.json` names the layers and the folder root (`modules.paths`). A footprint resolves to the set of folders and layers it touches. Two tickets in the same folder are treated as conflicting by default, because a folder is the unit that has an entry point and a README that both would edit.

A prediction from the code (grep for the symbols a ticket names) is possible but is a model-shaped guess. It is left out of the first build; the footprint is declared in the ticket, and an undeclared one is serial.

### The rule

`schedule(a, b, map) -> {verdict: 'parallel' | 'serial', reason}`, pure, first match wins:

1. Either ticket is serial-class (section 5) -> `serial`, reason `serial-class`.
2. One depends on the other, directly or transitively -> `serial`, reason `dependent`.
3. Either footprint is unknown -> `serial`, reason `unknown-footprint`.
4. The footprints share a path, or one path contains the other -> `serial`, reason `same-path`.
5. The footprints resolve to a shared folder -> `serial`, reason `same-folder`.
6. Otherwise -> `parallel`.

A second pure function, `pick(candidates, running, parallelism, map)`, walks the engine's ordered candidates (the existing `next` order is kept) and returns those that are `parallel` with every running ticket and with each other, up to the parallelism limit. The first candidate is always taken when nothing runs, so parallelism of 1 reproduces today's behaviour exactly.

### Example pairs

| Ticket A (knock-on) | Ticket B (knock-on) | Verdict | Reason |
|---|---|---|---|
| a new check in `checks/` | a doc fix under `docs/` | parallel | disjoint folders |
| `loop/merge.ts` | `loop/outcome.ts` | serial | same folder |
| `loop/merge.ts` | `backlog/github-backlog.ts` | parallel | disjoint folders, no dependency |
| `cli/merge.ts` | `loop/merge.ts` blocked by A | serial | dependent |
| a pack under `packs/` | no knock-on section | serial | unknown footprint |
| `docs/02-the-loop.md` | `docs/02-the-loop.md` | serial | same path |
| a stored-shape change in `loop/state.ts` | `checks/` | serial | serial-class |
| a migration under `migrate/` | `docs/` only | serial | serial-class |

Docs are not a folder in the map, so two tickets that edit different docs run together and two that edit the same doc do not. The README of a touched folder counts as part of that folder's folder.

## 2. Isolation, currency and the second merge

Options:

- **(a) One checkout, workers take turns on it.** No parallelism.
- **(b) One git worktree per worker.** Each worker has its own working tree and branch and shares the object store. Cheap, and the existing "compare in a separate worktree" lesson in the failure catalogue already points this way.
- **(c) One clone per worker.** Heavier, no benefit over (b) here.

Recommendation: (b). The engine creates `<state dir>/worktrees/<ticket>` from the base branch before the run and removes it after, as a tested command that returns the path. The supervisor rule that nobody changes HEAD or the tree in a worker's repo holds per worktree, and the main checkout is never a worker's tree once parallelism is above 1.

**Staying current.** The footprint rule makes a textual conflict unlikely, not impossible: a prediction can be wrong. Before the worker pushes, a command rebases the branch on the current base and reports `clean` or `conflict`. After the first PR of a pair merges, the second worker is told by the same command, not by a CI failure.

**The second PR conflicts.** Tried in this order, each one a recorded outcome:

1. The worker resolves it in the existing `merge_conflicts` skill slot (built-in: by hand), re-runs the gates and pushes. One attempt.
2. If the rebase is not clean after that attempt, the run ends as `conflict`: a failure that counts toward the stall counter, the branch is deleted and the ticket stays open for a later, serial run. No work is lost silently and no merge is forced.
3. A `conflict` between two tickets the rule called parallel is evidence the footprint was wrong; the measures (section 4) surface it, and the pair is added to a recorded do-not-pair list the rule reads.

## 3. Engine changes

- **Lock.** The single-pid lock becomes a lock on the supervisor, which stays one process; it is the only holder of the engine lock. Workers are children it spawns and tracks. The simplest design keeps `decideLock` untouched.
- **State.** `current_task` and `snapshot` move into a list of in-flight runs keyed by ticket, each with its own pid, session, snapshot and start time. The counters (`stall_count`, `consecutive_failures`) stay global. A new loop-state shape is a stored-shape change, so a pure migration from the old shape is part of the first build and the old shape reads as one in-flight run.
- **Status.** `status --json` reports one entry per in-flight run plus the totals, with liveness per pid.
- **Budgets.** The budget cap is a cap on the loop, shared across workers: spend is summed from the run facts, and a new worker is not started when the remainder is below a configured floor. Each worker keeps its own run timeout, killing its own process group.
- **HALT.** One HALT file stops the loop; when it appears, no new worker starts and in-flight workers are given the grace period, then killed by group. A worker that ends in an infrastructure error trips HALT as today.
- **Counters.** A stall is "no merge across a window", read over the whole loop, so parallel merges reset it as a single merge does. `consecutive_failures` counts in completion order. A `conflict` outcome counts as a failure once; it does not double-count the loser and the winner.
- **Config.** `parallelism` in the workloop config, default 1, validated as a positive integer, and capped by the number of runnable candidates the rule returns.
- **CI-native mode.** The concurrency group is the single-worker guard there. It is raised only when parallelism is above 1 and the workflow carries the same footprint rule; until then it stays at one.

## 4. Measures

The measures command gains, computed from the events and the PR facts and never from the worker's account:

- merges per hour of wall time, split by parallelism in force during the run;
- conflict rate: `conflict` outcomes over merged-or-conflicted runs, and the pairs involved;
- rework: runs that needed a conflict-resolution attempt, and tickets re-run after a `conflict`;
- the rule's verdict mix, so a rule that says `serial` almost always is seen as one that buys nothing.

Parallelism is worth keeping when merges per hour rise and the conflict rate stays low; if the conflict rate climbs, the default drops back to 1 by config and nothing else changes.

## 5. What stays serial

A ticket is serial-class when it carries the `serial` label, or its footprint matches any of the configured serial patterns. Defaults chosen:

- migrations, including anything under `migrate/`;
- anything that changes a stored shape (the state file, the backlog, the lock, event and verdict records, the config schema);
- wide mechanical changes (a rename or format change across folders), which the author labels `serial` because their footprint is the whole tree;
- changes to the architecture map and to the gates themselves, since every other worker's checks read them.

A serial-class ticket runs alone: it starts only when nothing runs, and nothing starts while it runs.

## Recommendation

Adopt (b) with the rule above, a default parallelism of 1 and a limit of 2 for the first release behind the config setting. Defaults, for the owner to overturn:

1. Declared footprints only; unknown is serial.
2. Folder granularity for conflicts; file granularity is a later setting.
3. One conflict-resolution attempt by the worker, then a recorded `conflict` and a serial retry.
4. One supervisor, N workers, one shared budget and one HALT.

## Consequences

- Every decision (the pairing rule, the pick, the footprint parse, the serial classification, the state migration, the conflict outcome) is a pure function or a tested command; the prompt keeps only the judgement of resolving a real conflict.
- Parallelism of 1 behaves as today, so the change is safe to ship dark.
- Ticket quality matters more: a ticket without a knock-on section is serial, which rewards the template.
- The cost is a heavier state shape and a conflict path to maintain. The measures decide whether it earns that.
- Build work is filed as separate tickets awaiting triage: the pure scheduling rule, the worktree and rebase commands, the in-flight state and status, the supervisor running two workers behind the config setting, then the measures.
