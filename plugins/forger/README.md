# `forger` - unattended development loop

A Claude Code plugin that implements backlog tickets one at a time, unattended,
with a human-facing supervisor and an interactive planner. The engine is generic;
everything project-specific lives in the consumer repo's `.claude/`.

It is built to sit **on top of
[mattpocock-skills](https://github.com/mattpocock/skills)**: the planner runs
Matt's `grilling` and `domain-modeling` skills, the worker runs his `tdd`,
`code-review`, `diagnosing-bugs` and `resolving-merge-conflicts`, and the loop
adopts tickets published by his `to-tickets`, `triage` and `wayfinder`. Every
hook degrades to an inline fallback when the plugin is absent, so nothing
breaks without it; it is just sharper with it.

Work is tracked on **GitHub Issues**.

## Command surface

The commands split on one axis - **who invokes them** - and the naming encodes
it. Commands without the infix are human entry points and carry
`disable-model-invocation`, so only a person can fire them (the same axis
mattpocock-skills uses). The `-auto-` infix marks self-regulating commands the
loop drives with no human in the turn. All share the `forger:` prefix, so
typing `/fyne` in Claude Code surfaces the set.

### Human entry points

| Command | Role |
|---|---|
| `/forger:setup` | **Onboarding** - scaffold `.claude/`, pick the tracker, create the intake label, and point at the companion skills. Idempotent; never overwrites. |
| `/forger:plan` | **Interactive planner** - grounds itself in the repo, scopes the session, grills you (with `grilling` + `domain-modeling` when available), then crystallises a plan doc, tracker issues and queued tickets. Needs a human to answer. |
| `/forger:work` | **Supervisor** - start (or attach to) the loop, watch it, report on completion or halt. Idempotent: "start it, or show me where it's at." Never implements. |

### Machine-internal

| Command | Role |
|---|---|
| `/forger:auto-ticket` | **Worker** - implements exactly one ticket end to end (claim, code, tests, gates, review, PR, merge) and signals the engine. The engine spawns a headless `claude` running this each iteration. |
| `/forger:auto-plan` | **Autonomous planner** - turns a spec, phase doc, resolved wayfinder map, or `ready-for-agent` issues into tickets with no questions, so the loop can plan the next chunk unattended. |

`/forger:work` never implements - it supervises. The implementing is done by
the headless `claude` processes the engine spawns, each running
`/forger:auto-ticket`.

## Working with mattpocock-skills

### Install

```
claude plugins install mattpocock-skills
```

Then, once per repo, `/setup-matt-pocock-skills`. It writes
`docs/agents/issue-tracker.md` (which this plugin treats as the authority on
tracker operations when present), seeds `CONTEXT.md` and the ADR layout, and
sets up the triage labels. Pick GitHub there and `tracker.kind` here should
agree; `/forger:setup` checks that.

### Who calls what

Matt's skills split into user-invoked (only a human can type them:
`grill-me`, `grill-with-docs`, `wayfinder`, `to-spec`, `to-tickets`, `triage`,
`implement`) and model-invoked (any skill or command may call them). This plugin
only ever calls the model-invoked ones; the user-invoked ones are stages that
sit **beside** the loop and feed it through the tracker.

| Command | Step | Skill called when installed | Fallback |
|---|---|---|---|
| `plan` | 3, grill | `grilling`, then `domain-modeling` | inline frontier-round interview |
| `auto-ticket` | 4, implement | `tdd` | red-green-refactor by hand |
| `auto-ticket` | 5, gates red | `diagnosing-bugs` | one honest attempt, then stop |
| `auto-ticket` | 6, review | `code-review` (fixed point = base branch) | two-axis self-review, or the agent `process.md` names |
| `auto-ticket` | 8, merge conflict | `resolving-merge-conflicts` | resolve by hand, never abort |

### The pipeline

```
fog                      route clear                    build
/wayfinder  ---------->  /to-spec  or  /forger:plan  -->  /forger:work
(decision tickets on      (spec issue, or grill only              (worker per ticket,
 the tracker)              the gaps the map left)                  PR closes the issue)
                                   |
                    /to-tickets, /triage --> ready-for-agent issues
                                   |
                          /forger:auto-plan adopts them
```

- **Fog** (the route to a spec is not visible): the human runs `/wayfinder`. Its
  decision tickets live on the tracker under a `wayfinder:map` issue. The loop
  never touches `wayfinder:*` issues; they are decisions, not work.
- **Route clear**: `plan` reads the map's "Decisions so far" as settled and
  grills only the gaps. `auto-plan` accepts a map with no open children as
  its spec.
- **Intake**: anything published as `ready-for-agent`, by `/to-tickets`,
  `/triage`, or a human, is adopted into the backlog by the planners and by the
  worker's inbox step, with blocking edges mapped to `depends_on`.

`plan` is the forger-flavoured `grill-with-docs`: the same two skills,
wrapped in repo grounding before and tickets, issues and a plan doc after.

## Tracker: GitHub Issues

`backlog.json` remains the loop's source of truth for status: the engine selects
tickets from it offline and deterministically. The tracker is the human-facing
mirror and the intake channel.

- **Planners** create one issue per ticket (label `ready-for-agent`, blocking
  edges as GitHub's native blocked-by dependencies) and record the number as
  `issue`.
- **The worker** claims the issue by assigning itself, and puts `Closes #n` in
  the PR body so the squash merge closes it. No extra calls, no drift.

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
creates the `ready-for-agent` label, gitignores the per-run state, and tells you
whether to install mattpocock-skills or run `/setup-matt-pocock-skills`.

Then fill in `.claude/process.md` - the project's rules and **gotchas**. The
worker treats these as enforced. Run `/forger:plan` to generate the
first tickets, and `/forger:work` to start.

By hand, the equivalent is:

```
mkdir -p .claude
cp "$CLAUDE_PLUGIN_ROOT/templates/workloop.config.json" .claude/
cp "$CLAUDE_PLUGIN_ROOT/templates/process.md"           .claude/
cp "$CLAUDE_PLUGIN_ROOT/templates/backlog.json"         .claude/
gh label create ready-for-agent
```
and gitignore `.claude/state.json`, `.claude/work.log`, `.claude/output/`,
`.claude/HALT`.

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
| `paths` | Where the backlog, state, log, output dir, and HALT file live. |
| `tracker` | `{ kind, label }`. `kind` is `github` (default), `local`, or `none`. `label` is the intake label, default `ready-for-agent`. When `docs/agents/issue-tracker.md` exists it is the authority on how to talk to the tracker. |

## How the engine runs

The commands invoke the engine at `${CLAUDE_PLUGIN_ROOT}/bin/work.ts`, always
from the consumer repo root so it finds `.claude/`:

```
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts run --continuous   # the loop
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts status             # where it's at
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts resume             # clear a HALT
```

The loop stops when the backlog empties, a HALT file appears, it stalls (no
progress for `maxStallIterations`), or it hits `maxConsecutiveFailures`.

The headless worker inherits the user's plugins, so mattpocock-skills is
available inside the loop wherever it is installed for the user running it.

## Engine development

The engine is a real, tested project under `engine/`:

```
cd engine
bun install
bun test          # unit tests for config merge, ticket selection, tiering,
                  # prompt building, merge verification, and stall detection
bun run typecheck # tsc --noEmit
```

Layout - pure logic is split from I/O so it is unit-testable without a repo:

```
engine/src/
  config.ts    types, defaults, mergeConfig (pure) + loadConfig
  backlog.ts   ticket selection, remaining/workable counts, tiering (pure)
  prompt.ts    per-iteration prompt (pure): worker command, gates, tracker
  git.ts       merge verification against an injectable command runner (pure)
  state.ts     state shape, stall detection (pure) + StateStore (I/O)
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
