# checks/journeys

`check journeys`: the few things a person must be able to do, each run as the
project's own command against a running build. A failing journey is a finding;
no journey named is a gap.

## Files

- `journeys.ts` - the config, the shell wrappers and the verdicts. Pure.
- `run.ts` - starts and stops the app and runs the journeys through
  the injected command function. Touches the world.

## Entry point

`index.ts`.

## May import

The core: `../waivers`, `../gaps`, `config`, `ports`.
