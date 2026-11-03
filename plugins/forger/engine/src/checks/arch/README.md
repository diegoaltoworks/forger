# checks/arch

`check arch`: the dependency rule. A project names layers as path globs in
`.claude/architecture.json` and says which may import which; an import across a
forbidden edge is a finding.

## Files

- `arch.ts` - parsing the layer map, extracting and resolving imports, checking
  edges. Pure.
- `arch-check.ts` - reads the layer map and the tracked sources. Touches the
  world.

## Entry point

`index.ts`.

## May import

The core: `../waivers`, `ports`.
