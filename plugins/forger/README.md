# `forger` - unattended development loop

A plugin that implements backlog tickets one at a time, unattended,
with a human-facing supervisor and an interactive planner. The engine is generic;
everything project-specific lives in the consumer repo's `.forger/`, a folder forger owns,
so no harness's own settings are mixed with it.

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
typing `/forger` in the harness surfaces the set.

### Human entry points

| Command | Role |
|---|---|
| `/forger:setup` | **Onboarding** - scaffold `.forger/`, pick the tracker, and create the intake label. Idempotent; never overwrites. |
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
  adopted into the backlog by the planners and by the worker's work order step, with
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
rather than reading as an empty backlog, and its error quotes what `gh` printed.

The query reads the open intake issues and only the most recently closed ones;
a dependency's status comes with the blocker itself, so the closed history is
never scanned. Its page sizes are kept small, and a test holds the query's
worst-case rate-limit cost, computed from the query text, to a stated budget. A
list longer than its page fails the read rather than dropping a blocker. The
engine reads the backlog once per iteration (after the worker runs) and reuses
it; one `status` or `backlog` call is one read.

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
| `design` | `plan` | a grey-box HTML wireframe under `docs/design/<ticket>/`, captured by `screenshot --wireframe` (with the ui pack) |
| `test_first` | `auto-ticket` | failing test, then pass, then refactor |
| `review` | `auto-ticket` | the diff against the base, on standards and spec |
| `diagnose` | `auto-ticket` | reproduce the red gate, one hypothesis, test it |
| `merge_conflicts` | `auto-ticket` | resolve by hand, re-run the gates |
| `risk` | `auto-ticket` | list what the change touches beyond the diff, run the tests for it (input to the worker, never a verdict) |
| `pr_body` | `auto-ticket` | write the PR body by `docs/03-tickets.md`; `pr-body` keeps `Closes #<n>` and the review sections |
| `retro` | `retro` | the retro steps as written |

Map a slot to a skill in the `skills` section of `.forger/workloop.config.json`:

```json
{ "skills": { "review": "some-collection:code-review" } }
```

A slot can also point at a file, for a skill the harness will not invoke by name
(many collections mark their skills as user-invoked only):

```json
{ "skills": { "review": { "file": "skills/code-review/SKILL.md" } } }
```

A relative path is looked up under each installed plugin's root, then under the
forger plugin root; an absolute path is used as it is. The worker reads the file
and follows it.

An unmapped slot, a skill that is not installed, or a file that is missing uses
the built-in step. The commands never name a skill: they run `skills --json`,
which reports for every slot how it is invoked (`invoke`: `skill`, `file` or
`builtin`), the resolved `path` of a file slot, and whether it is present. It
also reports the `preamble` and the `forbid` list.

Every `skill` or `file` invocation starts with the engine-owned `preamble`: the
intent is the ticket and its spec, never ask the owner (an open question is a
decline), do not commit, push, merge or open pull requests (forger does), and do
not route to another skill or start a loop. A preset's `forbid` lists the skills
of its collection the worker must not invoke: routers, loops and anything that
owns the process.

**Worked example: the mattpocock-skills collection.** The preset
`plugins/forger/presets/mattpocock-skills.json` maps that collection onto the
slots it covers. `/forger:setup` offers it when the collection is installed, or
apply it directly with `setup --preset mattpocock-skills`. A preset is a plain
file: copy it to map another collection. Besides the slot mapping it declares
how to find the collection (`collection` and `plugin` for a prefixed plugin
install, `aliases` for the bare skill names of an install without a prefix) and
the `forbid` list, so detection and resolution work with or without the prefix.

**The `design` slot** (ui pack) maps like any other. Examples: a Figma MCP
server for boards, a prototype skill from an installed collection, or artifacts
in an interactive session. Unmapped, the built-in step needs no tool: a static
grey-box wireframe in `docs/design/<ticket>/`, captured with
`screenshot --wireframe <ticket>`.

## Adapters

Forger's decisions live in tools, so the model and the harness are adapters (see
principle 0a in [`docs/01-principles.md`](../../docs/01-principles.md)). Today
there is one model mapping and several harnesses, named here and nowhere else in the prose:

- **Agent adapter.** The engine spawns workers through the `AgentRunner`
  interface, built from a `Harness`. The default harness runs Claude Code's headless `claude` CLI, mapping
  the role a ticket is given (`fast`, `standard`, `deep`) to the model id set
  under `models` in the config.
- **Harness.** What differs between agent tools sits behind the `Harness` seam: how the worker is spawned
  headless, where its commands are installed, and the variable that holds the plugin root. Set `harness`
  in the config (`claude`, the default, `opencode`, `codex` or `copilot`). `setup --harness <id>` writes the packaged
  commands: OpenCode reads them from `.opencode/commands/`; Codex and Copilot read repository skills, so
  they go to `.agents/skills/` and `.github/skills/`, and the worker is started by naming its skill. The steps exist once, in `commands/`; an adapter repackages them
  (frontmatter, plugin root) and never copies their text per harness. OpenCode takes a model as
  `provider/model` and has no spend cap, so map the roles under `models` to such ids. Codex and Copilot have no spend cap either.

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

Already-onboarded repos keep working with their files in `.claude/` (the legacy layout):
every command prints one warning naming `migrate`, which moves them to `.forger/`. An old config without a
`tracker` section gets the GitHub default on merge; set `tracker.kind` to
`local` or `none` in repos that should stay off GitHub Issues, and run
`gh label create ready-for-agent` in repos that opt in.

## Prerequisites

- [Bun](https://bun.sh) on `PATH` (the engine is a Bun program).
- The `claude` CLI on `PATH` (the engine spawns it per iteration).
- The `gh` CLI, authenticated, when `tracker.kind` is `github`.

## Onboard a repo

Run `/forger:setup`. It copies the templates into `.forger/` (never
overwriting), asks for the gates command and base branch, decides the tracker,
creates the `ready-for-agent` label, and gitignores the per-run state.

Then fill in `.forger/process.md` - the project's rules and **gotchas**. The
worker treats these as enforced. Run `/forger:plan` to generate the
first tickets, and `/forger:work` to start.

The copy is a tested command: `bun "$CLAUDE_PLUGIN_ROOT/bin/work.ts" setup --json
[--gates CMD] [--base-branch B] [--tracker KIND] [--preset NAME] [--packs A,B] [--harness H]`. It installs the
chosen opinion packs (default `base`), records them in `.forger/forger.lock.json`, and writes `.forger/` files
only where they are absent, installs the default `process.md`, the ticket, PR,
work order, report, retro and rule templates and the hook policy
(`.forger/hooks.json`), adds the docs check to the gates, installs the harness
hook that refuses a worker's hand merge, base-branch or forced push, status
write and state edit, and gitignores the per-run state. Create the label with
`gh label create ready-for-agent`.

## Configuration

`.forger/workloop.config.json` (any field omitted falls back to the default):

| Field | Meaning |
|---|---|
| `repo` | If set, only tickets with this `repo` (or none) are worked here. `null` = no filter. |
| `harness` | The harness that runs the worker: `claude` (default) or `opencode`. |
| `worker_command` | Slash command the engine invokes per iteration. Default `forger:auto-ticket`. |
| `gates` | The quality-gate command; surfaced to the worker. |
| `base_branch` | Branch an iteration must land on. Merge verification checks HEAD against it. |
| `models` | Role -> model id the agent adapter is given. Default `fast`, `standard` and `deep`. A project remaps a role here, and tickets, logs and docs keep naming the role. |
| `model_by_priority` | Role + USD budget per priority (`P0`, `default`, and any others). A tier naming something that is not a role is taken as a literal model id, so an older config keeps working. |
| `effort_multiplier` | Budget multiplier by ticket `effort` (`small`/`medium`/`large`/...). |
| `limits` | `timeoutMinutes`, `killGraceSeconds` (SIGTERM to SIGKILL on timeout), `maxConsecutiveFailures`, `pauseBetweenIterations`, `pauseAfterFailure`, `maxStallIterations`. |
| `paths` | Where the backlog, state, log, output dir, HALT file, engine lock, terminal-event file, verdicts directory and `process.md` live. The verdicts stay local, not committed; the dirty-tree check skips them. Default under `.forger/`. |
| `local_only` | Paths that stay modified in a checkout without being the worker's doing (local settings, a work order). The dirty-tree check skips them and the engine's own files (`paths`); a directory covers what is under it. Default none. |
| `model_names` | Model and vendor names `check docs` flags in prose, as whole words, case-insensitively. Default a list of common ones. |
| `skills` | Skill slot -> installed skill name, or `{ "file": "<path to SKILL.md>" }` (see Bring your own skills). Default none: every slot uses its built-in step. |
| `state` | `{ home, branch }`. `home` is `local` (default: state and events sit in files beside the engine) or `branch` (they live on `branch` of the remote, default `forger-state`, and the engine holds a lease while it runs; ADR 0015). Move existing state with `migrate --state`; roll back by setting `home` back to `local`, nothing is deleted. Other values are refused when the config loads. |
| `tracker` | `{ kind, label, ignore }`. `kind` is `github` (default: issues are the backlog), `local`, or `none` (both read `backlog.json`). `label` is the intake label, default `ready-for-agent`. `ignore` lists labels whose issues are not work, a trailing `*` matching a prefix (`["wayfinder:*"]`); default none. |

## How the engine runs

The commands invoke the engine at `${CLAUDE_PLUGIN_ROOT}/bin/work.ts`, always
from the consumer repo root so it finds `.forger/`:

```
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts run --continuous   # the loop
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts status [--json]      # where it's at: runner pid and liveness, halt, counters, current ticket, next pick
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts backlog --json     # workable tickets, remaining, next pick
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts skills [--json] [--presets]  # each skill slot's configured skill, whether installed, and the built-in fallback; --presets lists offered presets
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts migrate [--json]      # move a legacy .claude/ layout to .forger/ (git mv where tracked; refuses while an engine holds the lock; safe to repeat)
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts packs [--json]        # available packs and which are installed
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts packs --detect [--json]  # packs the repo's own facts suggest, with the matching rules
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts opinions [--json]     # installed opinions: pack, rung, enforcing check
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts check [--json]       # every check the installed packs declare, with .forger/waivers.json applied; non-zero on an unwaived violation
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts check arch [--json]  # with the architecture pack: imports that cross a forbidden edge of .forger/architecture.json
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts check decisions [--json]  # with the architecture pack: a new dependency or layer-map change needs an ADR in the diff
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts check safety [--json]  # with the safety pack: added secrets and env files, and stored-shape changes with no test
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts check tests [--json]  # with the testing pack: a fix: commit needs a test change; unit tests may not import network or process modules
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts check coverage [--json]  # with the testing pack: line coverage must not fall below the generated baseline
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts check coverage --update  # raise the baseline to the current coverage; never lowers it
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts check ui [--json]  # with the ui pack: a branch that changes ui.paths must update files under docs/screenshots/, and UI files hold no raw colour literal outside ui.tokens
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts check a11y [--json]  # with the ui pack: serve the app and fail on serious or critical axe violations on every route, viewport and theme; exit 2 when Playwright, axe-core or the app is unavailable
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts check spec [--json]  # with the spec pack: the requirements the branch's issue names (Satisfies: line) are satisfied in the report and no MUST regresses; no report provider is a coverage gap, never a pass
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts screenshot [--json] [--wireframe <ticket>]  # --wireframe serves docs/design/ and captures <ticket>/index.html next to it; with the ui pack: start the app, capture every route x viewport x theme into docs/screenshots/, stop it; exit 2 when Playwright or the app is unavailable
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts brand  # render the brand PNGs and favicon.ico from the SVGs in assets/brand/ (needs the engine's dev dependencies installed)
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts check docs [--json]  # writing rules: ASCII punctuation, no emails or home paths, no hard-coded skill calls in commands or templates, no raw `gh pr merge` in a command file, optional .forger-denylist; with the docs pack also links, anchors, images, mermaid blocks and avoided glossary terms
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts resume             # clear a HALT
```

Each run's outcome is decided from git, not from the worker's exit code or its
own completion signal: the base branch moved on the remote (merged), the
worker's branch is on the remote (pushed), or neither. A run that merged and
then timed out is a success; a merge whose PR checks had failed or not finished
is `merged-red`, never a success, and halts the loop naming the PR and the
failing check; a run that claimed completion and merged nothing is a failure; a
ticket the backlog reads `completed` with nothing merged halts the loop for
recovery. The ticket a run is held to is the one the worker took,
read from its branch, which the log names when it differs from the engine's
pick.

A run that exits non-zero with an authentication, billing or network error is
an infrastructure error, not a worker failure: the loop halts at once with the
reason and the failure counter is left alone. A tracker read refused by
GitHub's rate limit is one too, naming the limit and its reset time (from
`gh api rate_limit`); the engine waits for the reset and carries on, never
charging the wait to a ticket. `resume` clears the HALT and zeroes
the failure and stall counters, so the first run after a fix starts clean, and
the first run after any start is never counted as a stall.

One engine works a repo at a time. `run` writes its pid to the lock file and
refuses to start while that pid is alive; a lock whose pid is dead is taken
over. If the previous engine died mid-iteration, the new one first closes that
iteration out, deciding its outcome from git as for any run, and only then
picks a ticket, so a ticket is not re-run blindly. Each terminal event
(completed, halted, stalled, timed out, too many failures, engine gone) appends
one JSON line to the event file, and `status --json` reports the engine, halt,
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

Layout - the source is one folder per domain, and the layer is in the path:
the pure core, `adapters/` for the side effects the core is handed, and `cli/`
which wires them together. `check arch` enforces the dependency rule through
`.forger/architecture.json`. Start at [`engine/src/README.md`](engine/src/README.md)
for the folder map; each folder's README says what it owns, which files are
pure, and what it may import. `bin/work.ts` is the stable entry the plugin
commands call.

## Safety

The worker runs headless with `--dangerously-skip-permissions`. Keep the repo's
data-safety and write-scope rules in `.forger/process.md` explicit and enforced
by tests, not convention - the loop will do exactly what the backlog tells it to.
