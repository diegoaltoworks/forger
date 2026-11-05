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
| `/forger:auto-ticket` | **Worker** - implements exactly one ticket end to end (claim, code, tests, gates, review, PR, merge) and signals the engine. The engine spawns a headless `claude` running this each iteration. |
| `/forger:retro` | **Refinement** - captures a signal verbatim, finds the cause from `measure`, writes a rule record or edits the project's own process by PR, and drafts an upstream issue for a lesson that holds everywhere. |
| `/forger:auto-plan` | **Autonomous planner** - turns a spec, phase doc, resolved wayfinder map, or `ready-for-agent` issues into tickets with no questions, so the loop can plan the next chunk unattended. |

`/forger:work` never implements - it supervises. The implementing is done by
the headless `claude` processes the engine spawns, each running
`/forger:auto-ticket`.

## The engine CLI

The commands invoke the engine at `${CLAUDE_PLUGIN_ROOT}/bin/work.ts`, always
from the consumer repo root so it finds `.forger/`. `work.ts help` prints the full usage.

```
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts run --continuous   # the loop
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts status [--json]      # where it's at: runner pid and liveness, halt, counters, current ticket, next pick
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts backlog --json     # workable tickets, remaining, next pick
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts skills [--json] [--presets]  # each skill slot's skill (skills map, then the flavour), whether installed, and the built-in fallback; --presets lists offered flavours
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts contract --slot SLOT --file PATH [--issue N] [--json]  # check a slot's result against its output contract; exit 1 unless ok
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts pipeline [--issue N] [--stage ID] [--json]  # the pipeline resolved for a ticket: each stage's slots, the skill or built-in chosen and why, the gate
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
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts ui approve STATE [--owner NAME]  # with the ui pack: record the committed captures of a named state as its approved baseline (the owner's action); check ui then fails when a capture drifts beyond the tolerance
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts check ui --states [--json]  # with the ui pack: serve the app and fail on a named state's assertions in ui.json (console errors, not_blank, in_viewport, visible, hidden, colour) at every viewport and theme; exit 2 when Playwright or the app is unavailable
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts check a11y [--json]  # with the ui pack: serve the app and fail on serious or critical axe violations on every route, viewport and theme; exit 2 when Playwright, axe-core or the app is unavailable
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts check spec [--json]  # with the spec pack: the requirements the branch's issue names (Satisfies: line) are satisfied in the report and no MUST regresses; no report provider is a coverage gap, never a pass
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts screenshot [--json] [--wireframe <ticket>] [--capture <name>]  # --capture records the scripted interaction declared under captures in ui.json as docs/screenshots/<name>.webm (and .gif with ffmpeg; exit 2 with how to add it without); --wireframe serves docs/design/ and captures <ticket>/index.html next to it; with the ui pack: start the app, capture every route x viewport x theme into docs/screenshots/, stop it; exit 2 when Playwright or the app is unavailable
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts brand  # render the brand PNGs and favicon.ico from the SVGs in assets/brand/ (needs the engine's dev dependencies installed)
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts check docs [--json]  # writing rules: ASCII punctuation, no emails or home paths, no hard-coded skill calls in commands or templates, no raw `gh pr merge` in a command file, optional .forger-denylist; with the docs pack also links, anchors, images, mermaid blocks and avoided glossary terms
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts resume             # clear a HALT
```

