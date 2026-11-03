# ui

The ui pack's engine half: its config, the capture matrix and the run that
turns a served app into screenshots under `docs/screenshots/`.

## Files

- `ui-config.ts` - `.forger/ui.json` parsed into types, with the defaults. Pure.
- `plan.ts` - every route x viewport x theme and the deterministic file each
  lands in. Pure.
- `wireframe.ts` - where a ticket's wireframe lives and the capture config for
  it (the `design` slot's built-in step). Pure.
- `capture.ts` - starts the app, waits for it, captures, stops it. Written
  against the `AppServer` and `Screenshotter` ports; touches nothing itself.

## Entry point

`index.ts`.

## May import

The core: `ports`.
