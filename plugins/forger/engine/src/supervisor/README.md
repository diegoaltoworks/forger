# supervisor

What a supervisor reads and decides while the loop runs: read-only facts about
the checkout and the tracker, what to do on arrival, the report, who may take
an action, and the measures and retro records the refinement loop runs on.

## Files

- `facts.ts` - branch, clean tree, issue to closing PR to merge, a PR's CI
  conclusion. Pure over an injected `CommandRunner`; read-only commands only.
- `supervisor.ts` - orient, report and approval. Pure.
- `measure.ts` - measures from iteration logs, budgets, events and CI runs;
  rule records and upstream drafts. Pure.
- `*.json` - recorded `gh` output the tests replay.

## Entry point

`index.ts`.

## May import

The core: `loop` (status, events, dirty-tree rule), `ports`.
