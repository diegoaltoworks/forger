# checks/decisions

`check decisions`: a dependency or a layer-map change lands with an ADR in
the same diff.

## Files

- `decisions.ts` - the rule over a parsed diff, and the content comparisons that tell a moved file from a changed one. Pure.
- `decisions-check.ts` - reads the branch's diff against its merge-base.
  Touches the world.

## Entry point

`index.ts`. `parseNameStatus` is shared with `safety/` and `testing/`.

## May import

The core: `../waivers`, `arch/`, `config`, `ports`.
