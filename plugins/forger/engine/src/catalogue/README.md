# catalogue

The failure catalogue's status: which entries are open, which are fixed, and
the tracker facts that decide it.

## Files

- `catalogue.ts` - parsing entries and their `**Status:**` lines, rewriting an
  entry from tracker facts, the generated index, and the check's findings. Pure.
- `tracker.ts` - the fix tickets' facts from GitHub, through a `CommandRunner`
  handed in. Pure over it.

## Entry point

`index.ts`. The `catalogue` command is in `cli/catalogue.ts`; `check docs` runs
`checkCatalogue`.

## May import

The core: `ports`.
