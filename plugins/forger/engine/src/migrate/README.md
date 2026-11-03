# migrate

Moves a repo from the legacy `.claude/` layout to `.forger/`: the plan is a pure
function over directory listings, the move uses `git mv` where a path is tracked
and a rename elsewhere, and it refuses while an engine holds the lock.

## Files

- `migrate.ts` - `planMoves` and `trackedNames` are pure; `runMigrate` moves the
  files, repoints the references inside the moved config, and gitignores the
  per-run files in their new home.

## Entry point

`index.ts`.

## May import

`config`, `loop` (the engine lock), `packs` (the gitignore lines) and `ports`.
