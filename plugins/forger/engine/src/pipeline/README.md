# pipeline

The pipeline as data (ADR 0016): the stages in order, the slots each runs, and
what a given ticket gets for each slot and why.

## Files

- `types.ts` - the definition, the overlay and the ticket facts a condition
  reads. Types only.
- `overlay.ts` - `mergeOverlay`: the shipped definition with a project overlay
  applied. An overlay may disable a stage, add a slot to a stage, or replace a
  gate. Anything else is a reported problem. Pure.
- `flavour.ts` - parses a flavour file. It picks the winning candidate of a
  slot for a ticket, with the reason each earlier one lost. It also gives the
  flavour as a plain skill mapping for a ticket with nothing. Pure.
- `resolve.ts` - `resolvePipeline`: resolves the merged definition by the
  `skills` map, then the flavour, then the built-in. It gives the reason for
  each choice. Pure.
- `contracts.ts` - the output contract of each slot, and a validator per
  contract. A validator checks the parsed result and the facts a caller passes
  in. Pure.
- `contract-policy.ts` - `onContractFailure`: retry, then the built-in step,
  then a decline. Pure.
- `contract-suffix.ts` - the shape of each contract and the suffix that tells a
  skill where to write its result. Pure.
- `eval.ts` - scores one result of a slot's skill against an eval case. The
  score uses the slot's contract validator and the case's properties. It also
  holds the prompt a case runs with. Pure.
- `load.ts` - reads `plugins/forger/pipeline/default.json`, the project's
  `.forger/pipeline.json` and the flavours (the project's, then the plugin's).
  Reads files.

## Entry point

`index.ts`. The commands are `pipeline --json` in `cli/pipeline.ts` and `contract --slot` in
`cli/contract.ts`.

## May import

The core: `config`, `checks`, `packs`.
