# pipeline

The pipeline as data (ADR 0016): the stages in order, the slots each runs, and
what a given ticket gets for each slot and why.

## Files

- `types.ts` - the definition, the overlay and the ticket facts a condition
  reads. Types only.
- `overlay.ts` - `mergeOverlay`: the shipped definition with a project overlay
  applied. An overlay may disable a stage, add a slot to a stage or replace a
  gate; anything else is reported as a problem. Pure.
- `resolve.ts` - `resolvePipeline`: the merged definition resolved against the
  skill mapping and what is installed, with the reason for each choice. Pure.
- `load.ts` - reads `plugins/forger/pipeline/default.json` and the project's
  `.forger/pipeline.json`. Reads files.

## Entry point

`index.ts`. The command is `pipeline --json` in `cli/pipeline.ts`.

## May import

The core: `config`, `checks`, `packs`.
