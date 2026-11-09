## What this is

A whole-repo structure review, filed by the loop because enough tickets merged, or the structure baseline grew past its threshold, since the last one.
The per-ticket check stops new debt; this review steps back and asks whether the tree still fits the product.
Read the code, not just the tree.

## What to build

Write `docs/review-code-structure.md`, overwriting the last one (git keeps the history). It covers each area below, ranks the findings by how much they hurt, gives a target structure with its rules, and names what to keep:

- how each package is organised, and the boundaries between packages
- the boundary between server code and browser code
- names against the glossary
- file sizes and folders that outgrew their purpose
- leftovers: dead code, shims, copies
- tests: where they live and what they leave unguarded
- the type safety of contracts between modules
- error handling
- i18n
- what will hurt first

Record the structure decision as an ADR.

Draft the follow-up tickets in the review, in this order, for the owner to file:

1. Enforcement: rules into `.forger/structure.json`, boundaries, frozen folders.
2. Expand: create the new folders.
3. Migrate: move files in batches.
4. Contract: empty the baseline, then freeze.

## Acceptance

- [ ] `ls docs/review-code-structure.md` exits 0
- [ ] `grep -c "## Findings" docs/review-code-structure.md` prints a number of at least 1
- [ ] `grep -c "## Target structure" docs/review-code-structure.md` prints a number of at least 1
- [ ] `grep -c "## Keep" docs/review-code-structure.md` prints a number of at least 1
- [ ] `grep -c "## Drafted tickets" docs/review-code-structure.md` prints a number of at least 1
- [ ] `grep -rlc "structure" docs/adr` prints a number of at least 1
- [ ] Gates green

## Guards

none

## Knock-on

`docs/review-code-structure.md`, the ADR folder, `.forger/structure.json` only when the review says so.

## Docs, examples and help

none

## Design review

none

## Languages

none
