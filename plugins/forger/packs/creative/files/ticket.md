<!-- Issue body for one ticket on creative work (games, demos, animation). Every section is present; one that does not apply says so in one line. -->

## Owner request

"<the owner's words, verbatim>" (<date>)

## Brief fit

<How this change serves the verbatim brief, in one or two sentences, or why it does not touch the brief.>

## What exists

<What the supervisor found before filing: the code involved with file paths, the likely cause, logs or data that confirm it.>

## What to build

<The change. Where a choice was needed, make it and say so: "Default, for the owner to overturn: ...">

## Juice

- <player action or event>: <the visual feedback>, <the motion>, <the sound>

(or "Juice: none" when nothing the player does or sees changes)

## Readable at a glance

<What a viewer must understand within a few seconds of seeing this, and the time-to-first-interaction budget: how long from opening to the first thing the viewer can do.>

## Acceptance

- [ ] <a testable outcome of a behaviour; never an exact shade, a palette size or a pixel count>
- [ ] <stored records from before carry forward unchanged, where a stored shape changes>

## UI states

<What the screen shows when empty, loading, failed and full, or "none" when no screen changes.>

## Guards

<Each guarantee the change must keep: the file that holds it and the value it holds (a coverage floor, a size budget, an approved baseline, an e2e layout floor), or "none" when the change touches no guarded area. `facts --guards <path>...` lists the guard files and the tests that name the paths the change touches.>

## Merge

<!-- "when green" (the default when this section is missing) or "owner reviews". Taste and an approved style frame are the owner's to judge: say owner reviews and why. -->

when green

## Knock-on

- Tests: <specs and unit tests that assert on what changes>
- Fixtures and shared regions: <defaults, helpers, shared layout it reaches>
- Stored shapes: <none, or how old records carry forward>

## Docs, examples and help

- Docs: <the docs that describe what changes>
- Examples: <worked examples, style frames, screenshots, captures>
- Help: <the help articles that cover it>

(or "Docs, examples and help: none")

## Design review

<The style frame to approve, linked, with the owner's approval, or "none".>

## Languages

<The wording added or changed, and that every offered language needs it, or "none".>

## Decisions

none
