# Loop state lives on a state branch and in the tracker

Status: Proposed

The engine's state sits in files in one checkout, so the loop stops when that machine sleeps and the supervisor has to read it from the same machine. The harness half of "tied to one harness and one laptop" was settled by ADR 0009 (everything forger owns is under `.forger/`); this ADR is the laptop half, and it is written so the CI-native mode in the roadmap needs no second move.

## Context

Evidence from the engine:

- `config/layout.ts` lists every forger-owned entry in `OWNED`; that list is the complete set of files to assign a home.
- `loop/lock.ts`: the runner lock is a file holding one pid, probed with signal 0. A pid means nothing on another machine.
- `loop/state.ts`: one `state.json` record. `loop/events.ts`: an append-only `events.jsonl`. `loop/iteration-log.ts` reads `output/iteration-N.log`. The HALT file is one file.
- The backlog is already shared: with the GitHub tracker the issues are the tickets (ADR 0001), and the claim is an assignment.
- `supervisor/` reads state, events and logs from the working tree, so it must sit beside the engine.

Three tests decide where a file goes:

1. Does a second machine need it to act correctly (to know the loop is running, halted, or what happened)?
2. Is it a decision the owner reviews (config, opinions, templates)? Those belong in the main branch with the code, reviewed by PR.
3. Is it written on every iteration? Those must not land on the main branch: they would be one commit per iteration in the history that reviewers read, and they would conflict with every worker's branch.

## Options

- **(a) Everything in the main branch.** Simple, but test 3 fails: per-iteration writes pollute main and race with feature PRs.
- **(b) Everything in the tracker** (comments, labels, a pinned issue). Visible on a phone, but comments are not a store: no atomic update, a rate limit, and a log of thousands of events does not fit a thread.
- **(c) A state branch for the machine-written files, the tracker for the owner-facing ones, the main branch for reviewed ones.** Each file goes where its access pattern fits.
- **(d) An external store** (a bucket, a database). It adds an account and a dependency to a tool that today needs only git and `gh`.

## Decision

Adopt (c).

### 1. Every file the engine writes, and its home

| File (logical, under `.forger/`) | Home | Why |
|---|---|---|
| `workloop.config.json`, `process.md`, `opinions/`, `templates/`, `rules/`, `architecture.json`, `testing.json`, `safety.json`, `ui.json`, `waivers.json`, `coverage-baseline.json`, `forger.lock.json` | shared, main branch (unchanged) | reviewed decisions, versioned with the code |
| `human.md`, `inbox/` | shared, main branch (unchanged) | the owner edits them and reviews the change |
| `backlog.json`, `backlog.md` | shared, main branch for the local and none trackers; absent with the GitHub tracker, where the issues are the backlog | already as today |
| `state.json` | shared, state branch | test 1 and test 3 |
| `events.jsonl` | shared, state branch, split into one file per UTC day (`events/YYYY-MM-DD.jsonl`) | append-only, so a day file only ever grows and two pushes rarely touch the same file |
| `lease.json` | shared, state branch (new) | the cross-machine lock (section 2) |
| `HALT` | shared, the tracker (section 3), mirrored locally | the owner clears it from a phone |
| `output/iteration-N.log` | local; a digest is published as an event | transcripts are large and may hold secrets; the facts a supervisor needs are already events |
| `work.log` | local | diagnostic text for the machine that ran |
| `runner.lock` | local | a pid, meaningful only beside the process; it guards one machine, the lease guards the loop |
| `.claude/settings.local.json` and other harness files | local, not forger's | ADR 0009 |

A pure function `homeOf(path) -> 'main' | 'state' | 'tracker' | 'local'`, with a test that every entry of `OWNED` has a home, makes this table the source of truth rather than this document.

### 2. Concurrency: a lease, not a pid

The state branch holds `lease.json`: `{holder, host, acquired_at, renewed_at, ttl_seconds}`. Git gives the atomic step for free: a non-forced push is a compare-and-swap, so two engines that both write the lease have exactly one winner, and the loser sees a non-fast-forward and re-reads.

- `decideLease(lease, self, now) -> acquire | renew | refuse | takeover` is pure. A lease is live while `now - renewed_at < ttl_seconds`.
- The engine renews on every iteration and on a timer inside a long run. An orphaned lease expires after the TTL; the next engine takes it over and the event log records the takeover with the previous holder.
- Default TTL: 15 minutes, longer than the renewal timer and shorter than the run timeout, for the owner to overturn. Clock skew between machines is bounded by using the push server's commit time as `renewed_at` for takeover decisions, not each machine's clock.
- The local `runner.lock` stays for the same-machine case and for `migrate`'s refusal; the lease is checked first.
- Parallel workers (ADR 0011) are children of the one lease holder, so the lease does not change that design.

### 3. HALT and the work order in the tracker

The owner acts from the tracker, so the owner-facing state lives there:

- HALT is the label `halted` on one pinned issue titled for the loop. The engine reads it with `gh`; setting it writes the reason as a comment. The owner clears it by removing the label. A local `.forger/HALT` file stays honoured as a per-machine kill switch.
- Human instructions are issues with the intake label, as `auto-ticket` already does with GitHub. `inbox/` stays for repositories without a tracker.
- The pinned issue's body is a one-screen status written by the engine (running or halted, holder, last merge), regenerated from state; it is a view, never read back as data.

### 4. How it meets #65 and CI-native

The `.forger/` move is done, so this ADR only adds a home per file. A new config key `state.home` takes `local` (default, today's behaviour) or `branch`, with `state.branch` defaulting to `forger-state`. In CI-native mode the workflow checks out the state branch next to the code: the same `branch` store, the lease replacing the concurrency group as the cross-run guard, and the concurrency group kept as a cheap first filter. One mechanism serves a laptop, a persistent machine and CI.

### 5. Migration without losing history

`migrate --state` is a command, idempotent and refusing while a runner lock or a live lease exists:

1. create the orphan `forger-state` branch if absent;
2. commit the existing `state.json` and `events.jsonl` (split by day, keeping every line and its order) as the first commit, so history starts where the local one ends;
3. set `state.home` to `branch`;
4. leave the local files in place and untracked; a second run finds the branch and changes nothing.

Rolling back is setting `state.home` to `local`; nothing is deleted.

### 6. What the supervisor reads off the engine's machine

`status`, `orient` and `measure` take their inputs through a `StateStore` port with two adapters, `local` (files) and `branch` (git fetch plus `git show` on the state branch, no checkout, so it never touches HEAD or the tree and respects the read-only rule for the worker's repo). The supervisor needs only a clone and `gh`, and the tracker for HALT and the status issue. Iteration transcripts stay on the engine's machine; the events carry the facts, and a missing transcript is reported as "not on this machine", never as an error.

## Defaults for the owner to overturn

1. Machine-written files on a state branch, owner-facing state in the tracker.
2. Lease TTL of 15 minutes, timed by the remote's commit time.
3. Transcripts and `work.log` stay local.
4. `state.home` defaults to `local`, so nothing changes until a project opts in.

## Consequences

- Every decision (the home of a file, the lease verdict, the migration split, the HALT read) is a pure function or a tested command; the prompt keeps none of it (ADR 0002).
- A sleeping laptop no longer stops a loop that another machine or CI can resume; the lease expires and a second engine takes over.
- The state branch is one more branch to keep out of reviewers' way; it carries no code and is never merged.
- Pushes to the state branch can fail on a network blip. The store retries a bounded number of times and treats a failed renewal as a lost lease, which halts the worker rather than running unguarded.
- The cost is a store port to maintain and a second read path in the supervisor. Opting in is by config, so the local loop keeps its simplicity.
- Build work is filed as tickets awaiting triage, ordered by their blockers: the file-home function, the pure lease decision, the state store port and git adapter, the supervisor reads through the store, HALT in the tracker, the migration, then the config setting that switches it on.
