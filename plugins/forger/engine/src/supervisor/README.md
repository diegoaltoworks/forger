# supervisor

What a supervisor reads and decides while the loop runs: read-only facts, the
report, who may act, and the measures the refinement loop runs on.

## Files

- `facts.ts` - branch, clean tree, issue to closing PR to merge, and a PR's CI
  conclusion (folded by the loop's `pr-checks.ts`). Pure over an injected
  `CommandRunner`. Read-only commands only.
- `supervisor.ts` - orient, report and approval. Pure.
- `measure.ts` - measures from iteration logs, budgets, events and CI runs;
  rule records and upstream drafts. Pure.
- `cost.ts` - a session's cost, from the usage in its transcript and a price
  table kept as data. Unknown without a transcript. Pure.
- `parallel-measures.ts` - merges per hour by parallelism, conflicts, rework and
  the scheduling rule's verdict mix. Pure.
- `comparison.ts` - the comparison report (ADR 0012). It holds the five
  measures of a run as one JSON document, and the per-measure delta between
  two reports. Pure.
- `rework.ts` - rework inside a window of later merges, escaped defects and
  pick-versus-built mismatch over merged PRs (ADR 0013). Pure.
- `journey-share.ts` - the share of merged PRs that changed a journey (by its
  `paths`) against upkeep. Pure.
- `waiting.ts` - what waits on the owner: parked issues, and Proposed ADRs with
  their stated recommendation. It also holds the report period with its
  merges. Pure.
- Reads of the state record and events go through the `StateStore` port
  (ADR 0015). The option `--from branch` reads the state branch of a clone,
  with no engine on the machine. It works on `status`, `orient`, `report` and
  `measure`. Inputs that stay on the engine's machine (iteration logs,
  transcripts) are listed as not on this machine. That is never an error.
- `multi.ts`, `follow.ts` - several loops under one supervisor. Events and
  reports carry a repository tag. The follower prints each event as it lands.
  Pure over injected readers.
- `*.json` - recorded `gh` output the tests replay.

## Entry point

`index.ts`.

## May import

The core: `loop` (status, events, dirty-tree rule), `ports`.
