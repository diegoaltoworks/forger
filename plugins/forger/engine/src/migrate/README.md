# migrate

Moves a repo from the legacy `.claude/` layout to `.forger/`: the plan is a pure
function over directory listings, the move uses `git mv` where a path is tracked
and a rename elsewhere, and it refuses while an engine holds the lock.

## Files

- `migrate.ts` - `planMoves` and `trackedNames` are pure; `runMigrate` moves the
  files, repoints the references inside the moved config, and gitignores the
  per-run files in their new home.

- `state.ts` - `migrate --state`: `splitEventsByDay` is pure (every line kept, in
  order, one file per UTC day); `runMigrateState` commits `state.json` and the
  day files as the first commit of the orphan state branch through the
  `StateBranch` port, then sets `state.home`. It refuses while an engine lock or a
  live lease exists, changes nothing on a second run, and leaves the local files
  in place.

## Entry point

`index.ts`.

## May import

`config`, `loop` (the engine lock and the lease decision), `packs` (the gitignore lines) and `ports`.
