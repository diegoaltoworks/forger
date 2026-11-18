# checks/models

`check models`: each model the config can pick is in the form the harness takes.
`run` also fails on an id the harness's catalogue lacks.

## Files

- `rules.ts` - the rules over the config, the harness and the catalogue's lines. Pure.
- `catalogue.ts` - runs the harness's listing command. A command that cannot run is one logged line, not a failure.
- `index.ts` - the form check `check` and `setup` call, and the sentence `run` refuses with.

A harness that says nothing about models is not checked.

## May import

The core: `../waivers`, `../../config`, `../../ports`.
