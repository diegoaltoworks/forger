# checks/hooks

`check hooks`: a missing or broken hook policy is a finding. So is a default
rule dropped without a waiver, or harness settings that do not run the hook.

## Files

- `hooks.ts` - the rules over the policy text and whether the settings run
  the hook. Pure.
- `hooks-check.ts` - reads `.forger/hooks.json` and the harness's settings.
  Touches the world.

## Entry point

`index.ts`.

## May import

The core: `../waivers`, `hooks`, `ports`.
