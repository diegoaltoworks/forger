# checks/safety

`check safety`: an added secret, a stored-shape change with no test, or a
failing dependency audit is a finding; no audit command is a gap.

## Files

- `safety.ts` - the rules over a parsed diff. Pure.
- `safety-check.ts` - reads the diff and `.forger/safety.json`. Touches the
  world.

## Entry point

`index.ts`.

## May import

The core: `../waivers`, `decisions/`, `config`, `ports`.
