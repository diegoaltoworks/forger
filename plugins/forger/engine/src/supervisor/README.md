# supervisor

What a supervisor reads and decides while the loop runs: read-only facts about
the checkout and the tracker, what to do on arrival, the report, who may take
an action, and the measures and retro records the refinement loop runs on.

## Files

- `facts.ts` - branch, clean tree, issue to closing PR to merge, a PR's CI
  conclusion (folded by the loop's `pr-checks.ts`). Pure over an injected `CommandRunner`; read-only commands only.
- `supervisor.ts` - orient, report and approval. Pure.
- `measure.ts` - measures from iteration logs, budgets, events and CI runs;
  rule records and upstream drafts. Pure.
- `cost.ts` - a session's cost from the usage in its transcript and a price
  table kept as data; unknown without a transcript. Pure.
- `parallel-measures.ts` - merges per hour by parallelism, conflicts, rework and
  the scheduling rule's verdict mix. Pure.
- `comparison.ts` - the comparison report (ADR 0012): the five measures of a run
  as one JSON document, and the per-measure delta between two reports. Pure.
- `rework.ts` - rework inside a window of later merges, escaped defects and
  pick-versus-built mismatch over merged PRs (ADR 0013). Pure.
- `*.json` - recorded `gh` output the tests replay.

## Entry point

`index.ts`.

## May import

The core: `loop` (status, events, dirty-tree rule), `ports`.
