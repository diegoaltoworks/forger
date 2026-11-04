# packs

Opinion packs and what installs them: pack manifests and the lock, `setup`, and
the skill slots a project can plug its own skills into.

## Files

- `packs.ts` - parsing manifests and the lock, listing packs and opinions;
  reads the pack directories and hashes the files it records.
- `setup.ts` - installs the chosen packs into a project, never overwriting.
  Writes files.
- `upgrade.ts` - `setup --upgrade`: the pure classifier over the lock, disk and
  pack hashes, and the shell that applies it. Never overwrites a file whose
  hash differs from the lock. Writes files.
- `skills.ts` - resolving each slot to a configured skill or its built-in
  fallback; reads the shipped flavours that map a collection (as presets) and
  the installed skills.

The parsing and listing functions in each are pure; the loaders read files.

## Entry point

`index.ts`.

## May import

Nothing outside the folder.
