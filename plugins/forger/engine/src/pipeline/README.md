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
- `contracts.ts` - the output contract of each slot and a pure validator per
  contract over the parsed result and the facts a caller passes in. Pure.
- `contract-policy.ts` - `onContractFailure`: retry, then the built-in step,
  then a decline. Pure.
- `contract-suffix.ts` - the shape of each contract and the suffix that tells a
  skill where to write its result. Pure.
- `load.ts` - reads `plugins/forger/pipeline/default.json` and the project's
  `.forger/pipeline.json`. Reads files.

## Entry point

`index.ts`. The commands are `pipeline --json` in `cli/pipeline.ts` and `contract --slot` in
`cli/contract.ts`.

## May import

The core: `config`, `checks`, `packs`.
