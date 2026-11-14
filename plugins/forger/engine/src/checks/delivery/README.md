# checks/delivery

`check delivery`: validates `.forger/deliver.json`, the project's own commands
to deploy, check and roll back a build after the merge. It runs none of them;
the plan a delivery follows is a pure function of the config.

## Files

- `config.ts` - the config, its validation and the delivery plan. Pure.
- `run.ts` - reads the file and reports its findings.

## Entry point

`index.ts`.

## May import

The core: `../waivers`, `config`.
