# migrate

Moves a repo from the legacy `.claude/` layout to `.forger/`, and refuses while
an engine holds the lock. The plan is a pure function over directory listings,
and the move uses `git mv` for a tracked path and a rename elsewhere.

## Files

- `migrate.ts` - `planMoves` and `trackedNames` are pure. `runMigrate` moves
  the files and repoints the references inside the moved config. It also
  gitignores the per-run files in their home under `.forger/`.
- `state.ts` - `migrate --state`. `splitEventsByDay` is pure. It keeps every
  line, in order, one file per UTC day. Then `runMigrateState` commits
  `state.json` and the day files as the first commit of the orphan state
  branch. It uses the `StateBranch` port, then sets `state.home`. It refuses
  while an engine lock or a live lease exists. It changes nothing on a second
  run. It leaves the local files in place.

## Entry point

`index.ts`.

## May import

`config`, `loop` (the engine lock and the lease decision), `packs` (the gitignore lines) and `ports`.
