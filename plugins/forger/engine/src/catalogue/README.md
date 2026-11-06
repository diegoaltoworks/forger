# catalogue

The failure catalogue: an Open table and a Fixed table, and the tracker facts
that decide which table a row belongs in.

## Files

- `catalogue.ts` - the two tables and the check's findings. It moves a row to
  the table the tracker names. Pure.
- `tracker.ts` - the issues' facts from GitHub, through a `CommandRunner`
  handed in. Pure over it.

## Entry point

`index.ts`. The `catalogue` command is in `cli/catalogue.ts`; `check docs` runs
`checkCatalogue`.

## May import

The core: `ports`.
