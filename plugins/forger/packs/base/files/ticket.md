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
