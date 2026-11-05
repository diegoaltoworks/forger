# ui

The ui pack's engine half: its config, the capture matrix and the run that
turns a served app into screenshots under `docs/screenshots/`.

## Files

- `ui-config.ts` - `.forger/ui.json` parsed into types (routes, named states with steps, captures), with the defaults. Pure.
- `assertions.ts` - a state's `assert` parsed, and evaluated over a page model (console, boxes, visibility, pixels). Pure.
- `plan.ts` - every route and named state x viewport x theme and the deterministic file each
  lands in. Pure.
- `wireframe.ts` - where a ticket's wireframe lives and the capture config for
  it (the `design` slot's built-in step). Pure.
- `capture.ts` - starts the app, waits for it, captures, stops it. Written
  against the `AppServer` and `Screenshotter` ports; touches nothing itself.
- `record.ts` - plans and runs one declared capture. It starts the app, records
  the steps as video, encodes a GIF and stops the app. It uses the `AppServer`,
  `Recorder` and `GifEncoder` ports.

## Entry point

`index.ts`.

## May import

The core: `ports`.
