# Commands

The slash commands a person or the loop runs, and the engine CLI behind them.

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
| `/forger:auto-ticket` | **Worker** - implements exactly one ticket end to end (claim, code, tests, gates, review, PR, merge) and signals the engine. The engine spawns the configured harness running this each iteration. |
| `/forger:retro` | **Refinement** - captures a signal verbatim, finds the cause from `measure`, writes a rule record or edits the project's own process by PR, and drafts an upstream issue for a lesson that holds everywhere. |
| `/forger:auto-plan` | **Autonomous planner** - turns a spec, phase doc, resolved wayfinder map, or `ready-for-agent` issues into tickets with no questions, so the loop can plan the next chunk unattended. |

`/forger:work` never implements - it supervises. The implementing is done by
the harness processes the engine spawns, each running
`/forger:auto-ticket`.

## The engine CLI

Run every command from the repository root, so the engine finds `.forger/`. Inside a harness the engine is at `${CLAUDE_PLUGIN_ROOT}/bin/work.ts`; from a clone it is at `<clone>/plugins/forger/bin/work.ts`. Most commands take `--json` for machine-readable output.

```
$ bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts status --json
```

`work.ts --help` lists every command with its flags. The tables name each command and its main argument only.

### Run the loop

| Command | What it does |
|---|---|
| `run` | Runs the loop for N iterations, or until the backlog is done with `--continuous`; `--detach` keeps it alive after the session ends. |
| `status` | Shows the engine's pid and liveness, any halt, the counters, the current ticket and the next pick. |
| `halt` | Halts the loop by hand, with an optional reason. |
| `resume` | Clears a halt and carries on. Needs `--cause <issue>` or `--not-a-defect "<why>"`, recorded with the failure. |
| `decide` | `decide <n> "<text>"` records the owner's answer under the Decisions section of an issue, with who and when; clears the halt when the loop is halted on that ticket. |
| `reset` | Resets the state to start fresh. |
| `recover` | Recovers the standing halt when its recovery is known and checkable, and says the one action otherwise. |
| `worktree` | Creates a ticket's own worktree and branch from the remote base branch. |
| `rebase` | Rebases a ticket's branch on the current remote base branch and reports clean, conflict or error. |

### Watch and report

| Command | What it does |
|---|---|
| `orient` | Says what the supervisor should do on arrival: surface a halt, attach, start or nothing. |
| `watch` | Shows live status, or follows the events of several loops. |
| `events` | Lists the terminal and mid-run events so far. |
| `await-event` | Blocks until an event past the first N arrives. |
| `report` | Reports across loops: merged, in progress, next, waiting on the owner, and the measures. |
| `measure` | Reports runs, failures by cause, time, cost, rework and escaped defects. |
| `retro` | Writes a rule record or an upstream issue draft from a captured signal. |
| `catalogue` | Lists the failure catalogue's rows and, with `--update`, syncs them with the tracker. |

### Tickets and pull requests

| Command | What it does |
|---|---|
| `backlog` | Lists the workable tickets in order, the remaining count and the next pick. |
| `link-blockers` | Links the issues under an issue's "Blocked by" heading as native blocked-by. |
| `decline` | Records that the engine's pick cannot be built and takes it out of the backlog. |
| `slice` | Prints the spec slice of each requirement a ticket's `Satisfies:` line names. |
| `intent` | Classifies a planning request as product or creative. |
| `pr-body` | Checks a PR body keeps its closing line and the ticket's review sections. |
| `facts` | Reads the branch, the issue, its closing PR and a PR's CI conclusion, changing nothing. `--guards <path>...` lists the guard files and the test files that name any of the paths. |
| `verify` | Runs a fresh-context verifier on a PR's head and records its verdict per criterion. |
| `merge` | Waits for every check, then squash-merges only a passing, verified PR. |
| `handover` | After a failed verify, says the next move or hands the ticket to the owner. |
| `critique` | Runs a critic on a change the audience sees and files its findings as tickets. |
| `approval` | Says who may do an action: alone, alone and report, the owner or never. |
| `replay` | Files stored owner requests as issues in a sample repository. |

### Checks

| Command | What it does |
|---|---|
| `check` | Runs every check the installed packs declare with waivers applied; name one (`arch`, `decisions`, `guards`, `docs`, `safety`, `tests`, `coverage`, `ui`, `a11y`, `spec`, `ticket`, `hooks`, `sandbox`) to run it alone. `check guards` fails when the diff against the merge-base loosens a guard file (a minimum lowered, a maximum raised, or a number of unknown direction changed), deletes a guard or test file, or adds a skip or focus to a test, unless the ticket's Decisions name the file; each finding says to ask the owner, who records it with `decide`. `check sandbox` tests the docker sandbox image against the image contract, one line per item, and exits 0 only when all pass. |
| `contract` | Checks the result a slot's skill wrote against the slot's output contract. |
| `eval` | Runs a slot's skill on the slot's cases and scores each result. |
| `run-logged` | Runs a command, passes its output through and appends it to a log the verifier checks. |
| `hook` | The harness's tool-call hook: refuses a call that breaks the hook policy. |

### Setup, packs and skills

| Command | What it does |
|---|---|
| `setup` | Installs the chosen packs into `.forger/` without overwriting, and records them in the lock file. |
| `migrate` | Moves forger's files from the legacy layout to `.forger/`, or the state to the state branch. |
| `packs` | Lists the available packs and which are installed; `--detect` suggests packs. |
| `opinions` | Lists each installed opinion with its pack, rung and enforcing check. |
| `skills` | Resolves each skill slot to its skill or the built-in fallback. |
| `pipeline` | Resolves the pipeline for a ticket: each stage, its slots and the gate after it. |

### UI and brand

| Command | What it does |
|---|---|
| `screenshot` | Starts the app and captures every route and named state at each viewport, theme and locale; `--before` also captures the base branch and writes a side-by-side image per changed screen. |
| `ui` | Approves the committed captures of a named state as its baseline (`ui approve`). |
| `brand` | Renders the brand PNGs and favicon from the SVGs in `assets/brand/`. |
