# catalogue

The failure catalogue: an Open table and a Fixed table, and the tracker facts
that decide which table a row belongs in.

## Files

- `catalogue.ts` - the two tables and the check's findings. It moves a row to
  the table the tracker names. It reads the facts as they will be once the
  branch's own ticket merges. Once that branch has an open PR, it fails an
  Open row whose only open issue is that ticket. Pure.
- `tracker.ts` - the issues' facts from GitHub, through a `CommandRunner` handed in.
  It also finds the ticket the checked-out branch works and its open PR.
  Pure over it.

## Entry point

`index.ts`. The `catalogue` command is in `cli/catalogue.ts`; `check docs` runs
`checkCatalogue`.

## May import

The core: `ports`.
