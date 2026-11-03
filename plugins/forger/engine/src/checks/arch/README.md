# checks/arch

`check arch`: the dependency rule. A project names layers as path globs in
`.forger/architecture.json` and says which may import which; an import across a
forbidden edge is a finding. Optionally the same file declares folders,
which get a README and a public entry.

## Files

- `arch.ts` - parsing the layer map, extracting and resolving imports, checking
  edges. Pure.
- `modules.ts` - the folder rules: a README per declared folder, imports from
  outside through the entry file. Pure.
- `arch-check.ts` - reads the layer map and the tracked sources. Touches the
  world.

## Entry point

`index.ts`.

## May import

The core: `../waivers`, `ports`.
