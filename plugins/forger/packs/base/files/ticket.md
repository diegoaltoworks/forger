<!-- Issue body for one ticket. Every section is present; one that does not apply says so in one line. -->

## Owner request

"<the owner's words, verbatim>" (<date>)

## What exists

<What the supervisor found before filing: the code involved with file paths, the likely cause, logs or data that confirm it.>

## What to build

<The change. Where a choice was needed, make it and say so: "Default, for the owner to overturn: ...">

## Acceptance

- [ ] <a testable outcome, in one of the four forms below>
- [ ] <stored records from before carry forward unchanged, where a stored shape changes>

Each criterion takes one of four forms, or the ticket is refused before a worker picks it (`check ticket <n>`):

- a named test that must pass: "`parse.test.ts` covers a blank line";
- a command with its expected exit code or output: "`bun run check` exits 0";
- a number with a unit and a source: "slope error within the `slope` row of the spike's thresholds table";
- a named UI state from `ui.json`, with its assertions or a screenshot.

Words such as "better", "nice", "fast" and "looks right" fail the check; say what is measured instead.

## UI states

<What the screen shows when empty, loading, failed and full, or "none" when no screen changes. Name each state; a state that is not its own route needs a `states` entry in `.forger/ui.json` (route plus steps), so `screenshot` can capture it. Put what must hold on the state under that entry's `assert` (no console errors, a region not blank, in the viewport, shown or hidden, a hue), so a defect fails before anyone looks.>

## Guards

<Each guarantee the change must keep: the file that holds it and the value it holds (a coverage floor, a size budget, an approved baseline, an e2e layout floor), or "none" when the change touches no guarded area. `facts --guards <path>...` lists the guard files and the tests that name the paths the change touches. A rule that contradicts a guarantee is a design question: raise it here, not when CI fails.>

## Placement

<The folder each piece of new code goes in, as backticked paths (`src/parse/`), or "none" when the ticket adds no file. Take it from `## Structure` in process.md and the structure pack's `.forger/structure.json`. A folder that is frozen or recorded over its limit takes no new file: move files out of it in this ticket and say so under "What to build", or file a ticket labelled `structure` that makes the folder and list it under "Blocked by".>

## Probe

<!-- Optional. Commands that measure the assumption this ticket rests on; the engine runs them before a worker starts and hands the ticket back if one fails. One per line, a backticked command then its expected result:
- `identify -format %w logo.png` prints a number of at least 40
- `test -f src/entry.ts` exits 0
Write "none" when nothing needs measuring first. -->

none

## Merge

<!-- "when green" (the default when this section is missing) or "owner reviews". Say why for the latter: the acceptance includes a judgement only the owner can make (taste, an approved baseline). -->

when green

## Knock-on

- Tests: <specs and unit tests that assert on what changes>
- Fixtures and shared regions: <defaults, helpers, shared layout it reaches>
- Stored shapes: <none, or how old records carry forward>

## Docs, examples and help

In the same PR, in every offered language:

- Docs: <the docs that describe what changes>
- Examples: <worked examples, sample names, wireframes, screenshots>
- Help: <the help articles that cover it>

(or "Docs, examples and help: none")

## Design review

<The design boards to redraw and review, or "none".>

## Languages

<The wording added or changed, and that every offered language needs it, or "none".>

## Decisions

none
