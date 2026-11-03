# checks/decisions

`check decisions`: a new dependency or a layer-map change lands with an ADR in
the same diff.

## Files

- `decisions.ts` - the rule over a parsed diff. Pure.
- `decisions-check.ts` - reads the branch's diff against its merge-base.
  Touches the world.

## Entry point

`index.ts`. `parseNameStatus` is shared with `safety/` and `testing/`.

## May import

The core: `../waivers`, `arch/`, `config`, `ports`.
