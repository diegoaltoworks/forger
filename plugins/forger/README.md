# `forger` - unattended development loop

A Claude Code plugin that implements backlog tickets one at a time, unattended,
with a human-facing supervisor and an interactive planner. The engine is generic;
everything project-specific lives in the consumer repo's `.claude/`.

Forger carries its own steps for planning, test-first implementation, review and
diagnosis; it depends on no other skill collection, and any installed skill can
replace a step (see Bring your own skills). Needs only Bun, the `claude` CLI and
`gh`.

Work is tracked on **GitHub Issues**.

## Command surface

The commands split on one axis - **who invokes them** - and the naming encodes
it. Commands without the infix are human entry points and carry
`disable-model-invocation`, so only a person can fire them . The `-auto-` infix marks self-regulating commands the
loop drives with no human in the turn. All share the `forger:` prefix, so
typing `/fyne` in Claude Code surfaces the set.

### Human entry points

| Command | Role |
|---|---|
| `/forger:setup` | **Onboarding** - scaffold `.claude/`, pick the tracker, and create the intake label. Idempotent; never overwrites. |
| `/forger:plan` | **Interactive planner** - grounds itself in the repo, scopes the session, interviews you in rounds, then crystallises a plan doc, tracker issues and queued tickets. Needs a human to answer. |
| `/forger:work` | **Supervisor** - start (or attach to) the loop, watch it, report on completion or halt. Idempotent: "start it, or show me where it's at." Never implements. |

### Machine-internal

| Command | Role |
|---|---|
| `/forger:auto-ticket` | **Worker** - implements exactly one ticket end to end (claim, code, tests, gates, review, PR, merge) and signals the engine. The engine spawns a headless `claude` running this each iteration. |
| `/forger:retro` | **Refinement** - captures a signal verbatim, finds the cause from `measure`, writes a rule record or edits the project's own process by PR, and drafts an upstream issue for a lesson that holds everywhere. |
| `/forger:auto-plan` | **Autonomous planner** - turns a spec, phase doc, resolved wayfinder map, or `ready-for-agent` issues into tickets with no questions, so the loop can plan the next chunk unattended. |

`/forger:work` never implements - it supervises. The implementing is done by
the headless `claude` processes the engine spawns, each running
`/forger:auto-ticket`.

## The pipeline

The roles, the lifecycle of a request, ticket statuses and the engine's
outcome decision are drawn in [`docs/02-the-loop.md`](../../docs/02-the-loop.md).

```
intent                         plan                       build
/forger:plan  ------------->  tickets + issues  ------>  /forger:work
(interview, plan doc)         (ready-for-agent)          (worker per ticket,
                                    ^                     PR closes the issue)
                                    |
                          /forger:auto-plan adopts
                          a spec or ready issues
```

- **Plan**: `plan` grounds itself in the repo, interviews you in rounds over the
  frontier of open decisions (numbered questions, each with a recommendation),
  then writes a plan doc, ADRs, issues and queued tickets. Vocabulary lives in
  `GLOSSARY.md`, decisions in `docs/adr/`.
- **Intake**: anything labelled `ready-for-agent`, from a planner or a human, is
  adopted into the backlog by the planners and by the worker's inbox step, with
  blocking edges mapped to `depends_on`. Issues labelled `wayfinder:*` are
  decisions, not work, and the loop never touches them.
- **Build**: the worker implements one ticket test-first, reviews its own diff on
  standards and spec, makes one honest diagnosis attempt when a gate is red, and
  resolves merge conflicts by hand rather than aborting.

## Tracker: GitHub Issues

With `tracker.kind` `github`, the issues are the backlog (see
`docs/adr/0001-github-issues-are-the-backlog.md`). The engine reads them with
one `gh api graphql` query and maps them to tickets:

| On the issue | On the ticket |
|---|---|
| open, with the intake label | `not_started`, id `issue-<n>` |
| closed by a merged PR | `completed` |
| closed any other way | `closed` - not done, and not work to start |
| `needs-human` / `deferred` label | `needs_human` / `deferred` |
| `P0`-`P3` label | `priority` (none reads as P3; ties go to the older issue) |
| `effort:small` / `effort:medium` / `effort:large` | `effort` |
| native blocked-by | `depends_on` |
| a label matching `tracker.ignore` | not a ticket |

A blocker that is not itself a ticket (no intake label, or ignored, such as a
decision) is satisfied once it is closed. A `gh` failure stops the engine
rather than reading as an empty backlog.

- **Planners** create one issue per ticket (intake label, blocking edges as
  GitHub's native blocked-by dependencies).
- **The worker** branches as `feat/issue-<n>`, claims the issue by assigning
  itself, and puts `Closes #n` in the PR body so the squash merge closes it.
  The merge is the status update.

With `local` or `none`, `backlog.json` is the backlog and the worker sets a
ticket's `status` there in its PR.

## Bring your own skills

Forger incorporates any skill you have installed. The points where a model does
judgement work are named **skill slots**, and each has a built-in forger step:

| Slot | Used by | Built-in step |
|---|---|---|
| `interview` | `plan` | numbered rounds of open decisions, each with a recommendation |
| `glossary` | `plan` | terms into `GLOSSARY.md`, decisions into `docs/adr/` |
| `test_first` | `auto-ticket` | failing test, then pass, then refactor |
| `review` | `auto-ticket` | the diff against the base, on standards and spec |
| `diagnose` | `auto-ticket` | reproduce the red gate, one hypothesis, test it |
| `merge_conflicts` | `auto-ticket` | resolve by hand, re-run the gates |

Map a slot to a skill in the `skills` section of `.claude/workloop.config.json`:

```json
{ "skills": { "review": "some-collection:code-review" } }
```

An unmapped slot, or a skill that is not installed, uses the built-in step. The
commands never name a skill: they run `skills --json`, which reports for every
slot the configured skill, whether it is installed, and whether the built-in
step applies, and invoke whatever it resolves.

**Worked example: the mattpocock-skills collection.** The preset
`plugins/forger/presets/mattpocock-skills.json` maps that collection onto the
slots it covers. `/forger:setup` offers it when the collection is installed, or
apply it directly with `setup --preset mattpocock-skills`. A preset is a plain
file: copy it to map another collection.

## Install and update

Add this repository as a marketplace once, then install. A local checkout works
as well as the GitHub repository, and installs alongside any other loop plugin:

```
claude plugin marketplace add <path-or-owner/repo>
claude plugin install forger@forger
```

Update on each machine, then restart Claude Code:

```
claude plugin marketplace update forger
claude plugin update forger@forger
```

Already-onboarded repos keep their `.claude/` files. An old config without a
`tracker` section gets the GitHub default on merge; set `tracker.kind` to
`local` or `none` in repos that should stay off GitHub Issues, and run
`gh label create ready-for-agent` in repos that opt in.

## Prerequisites

- [Bun](https://bun.sh) on `PATH` (the engine is a Bun program).
- The `claude` CLI on `PATH` (the engine spawns it per iteration).
- The `gh` CLI, authenticated, when `tracker.kind` is `github`.

## Onboard a repo

Run `/forger:setup`. It copies the templates into `.claude/` (never
overwriting), asks for the gates command and base branch, decides the tracker,
creates the `ready-for-agent` label, and gitignores the per-run state.

Then fill in `.claude/process.md` - the project's rules and **gotchas**. The
worker treats these as enforced. Run `/forger:plan` to generate the
first tickets, and `/forger:work` to start.

The copy is a tested command: `bun "$CLAUDE_PLUGIN_ROOT/bin/work.ts" setup --json
[--gates CMD] [--base-branch B] [--tracker KIND] [--preset NAME] [--packs A,B]`. It installs the
chosen opinion packs (default `base`), records them in `.claude/forger.lock.json`, and writes `.claude/` files
only where they are absent, installs the default `process.md`, the ticket, PR,
work order, report, retro and rule templates, adds the docs check to the gates
and gitignores the per-run state. Create the label with
`gh label create ready-for-agent`.

## Configuration

`.claude/workloop.config.json` (any field omitted falls back to the default):

| Field | Meaning |
|---|---|
| `repo` | If set, only tickets with this `repo` (or none) are worked here. `null` = no filter. |
| `worker_command` | Slash command the engine invokes per iteration. Default `forger:auto-ticket`. |
| `gates` | The quality-gate command; surfaced to the worker. |
| `base_branch` | Branch an iteration must land on. Merge verification checks HEAD against it. |
| `model_by_priority` | Model + USD budget per priority (`P0`, `default`, and any others). |
| `effort_multiplier` | Budget multiplier by ticket `effort` (`small`/`medium`/`large`/...). |
| `limits` | `timeoutMinutes`, `killGraceSeconds` (SIGTERM to SIGKILL on timeout), `maxConsecutiveFailures`, `pauseBetweenIterations`, `pauseAfterFailure`, `maxStallIterations`. |
| `paths` | Where the backlog, state, log, output dir, HALT file, runner lock and terminal-event file live. |
| `local_only` | Paths that stay modified in a checkout without being the worker's doing (local settings, a work order). The dirty-tree check skips them and the engine's own files (`paths`); a directory covers what is under it. Default none. |
| `skills` | Skill slot -> installed skill name (see Bring your own skills). Default none: every slot uses its built-in step. |
| `tracker` | `{ kind, label, ignore }`. `kind` is `github` (default: issues are the backlog), `local`, or `none` (both read `backlog.json`). `label` is the intake label, default `ready-for-agent`. `ignore` lists labels whose issues are not work, a trailing `*` matching a prefix (`["wayfinder:*"]`); default none. |

## How the engine runs

The commands invoke the engine at `${CLAUDE_PLUGIN_ROOT}/bin/work.ts`, always
from the consumer repo root so it finds `.claude/`:

```
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts run --continuous   # the loop
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts status [--json]      # where it's at: runner pid and liveness, halt, counters, current ticket, next pick
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts backlog --json     # workable tickets, remaining, next pick
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts skills [--json] [--presets]  # each skill slot's configured skill, whether installed, and the built-in fallback; --presets lists offered presets
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts packs [--json]        # available packs and which are installed
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts opinions [--json]     # installed opinions: pack, rung, enforcing check
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts check docs [--json]  # writing rules: ASCII punctuation, no emails or home paths, no hard-coded skill calls in commands or templates, optional .forger-denylist
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts resume             # clear a HALT
```

Each run's outcome is decided from git, not from the worker's exit code or its
own completion signal: the base branch moved on the remote (merged), the
worker's branch is on the remote (pushed), or neither. A run that merged and
then timed out is a success; a run that claimed completion and merged nothing
is a failure; a ticket the backlog reads `completed` with nothing merged halts
the loop for recovery. The ticket a run is held to is the one the worker took,
read from its branch, which the log names when it differs from the engine's
pick.

A run that exits non-zero with an authentication, billing or network error is
an infrastructure error, not a worker failure: the loop halts at once with the
reason and the failure counter is left alone. `resume` clears the HALT and zeroes
the failure and stall counters, so the first run after a fix starts clean, and
the first run after any start is never counted as a stall.

One runner works a repo at a time. `run` writes its pid to the lock file and
refuses to start while that pid is alive; a lock whose pid is dead is taken
over. If the previous runner died mid-iteration, the new one first closes that
iteration out, deciding its outcome from git as for any run, and only then
picks a ticket, so a ticket is not re-run blindly. Each terminal event
(completed, halted, stalled, timed out, too many failures, runner gone) appends
one JSON line to the event file, and `status --json` reports the runner, halt,
counters, current ticket and next pick, so a supervisor reads files and commands
rather than human text.

The loop stops when the backlog empties, a HALT file appears, it stalls (nothing
merged for `maxStallIterations` runs in a row), or it hits
`maxConsecutiveFailures`.

## Engine development

The engine is a real, tested project under `engine/`:

```
cd engine
bun install
bun test          # unit tests for config merge, ticket selection, tiering,
                  # prompt building, merge verification, run outcomes, and
                  # stall detection
bun run typecheck # tsc --noEmit
```

Layout - pure logic is split from I/O so it is unit-testable without a repo:

```
engine/src/
  config.ts    types, defaults, mergeConfig (pure) + loadConfig
  backlog.ts   the Backlog interface; ticket selection, remaining/workable
               counts, tiering, the backlog report (pure)
  file-backlog.ts the Backlog read from backlog.json
  github-backlog.ts the Backlog read from GitHub Issues: the query, and the
               issue-to-ticket mapping (pure) behind an injectable runner
  open-backlog.ts which Backlog the tracker kind selects
  prompt.ts    per-iteration prompt (pure): worker command, gates, tracker
  git.ts       merge verification against an injectable command runner (pure)
  run-facts.ts the git facts a run is judged by: merged, pushed, branch taken
  claim.ts     the worker's completion signal, parsed (pure)
  outcome.ts   a run's outcome from its facts (pure)
  infra.ts     tells infrastructure errors from worker failures (pure)
  state.ts     state shape, stall detection by merges (pure) + StateStore (I/O)
  logger.ts    terminal + file logging
  claude.ts    headless `claude` spawn (the side-effect boundary)
  runner.ts    orchestration: the run loop and one iteration
  cli.ts       arg parsing + dispatch
bin/work.ts    stable entry the plugin commands call
```

## Safety

The worker runs headless with `--dangerously-skip-permissions`. Keep the repo's
data-safety and write-scope rules in `.claude/process.md` explicit and enforced
by tests, not convention - the loop will do exactly what the backlog tells it to.
