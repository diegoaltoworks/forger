## What this is

An access review, filed by the loop because enough tickets merged since the last one.
No check can decide who may read or change whose data; this review reads the whole app and asks.
Read the code, not just the routes.

## What to build

Write `docs/review-access.md`, overwriting the last one (git keeps the history). It holds one row per route, handler or command that reads or changes stored data:

- the route, handler or command, and where it lives
- whose data it reads or changes: the caller's own, another person's, or shared
- what stops another person from using it, or that nothing does
- the test that shows another person is refused, or that none exists

Rank the rows with no refusal or no test by how much data they expose.
File one ticket per missing test or missing refusal, each naming the route and the person who must be refused.

## Acceptance

- [ ] `ls docs/review-access.md` exits 0
- [ ] `grep -c "## Findings" docs/review-access.md` prints a number of at least 1
- [ ] Gates green

## Guards

none

## Merge

when green

## Knock-on

`docs/review-access.md`, and the tickets it files.

## Docs, examples and help

none

## Design review

none

## Languages

none
