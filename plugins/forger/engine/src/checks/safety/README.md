# checks/safety

`check safety`: an added secret, or a stored-shape change with no test, is a
finding.

## Files

- `safety.ts` - the rules over a parsed diff. Pure.
- `safety-check.ts` - reads the diff and `.forger/safety.json`. Touches the
  world.

## Entry point

`index.ts`.

## May import

The core: `../waivers`, `decisions/`, `config`, `ports`.
