# backlog

What the loop works on, in what order. `Backlog` is the interface the loop
reads; a tracker is an adapter behind it.

## Files

- `backlog.ts` - the `Backlog` interface and the pure selection: workable
  tickets, the next pick, the model tier. Pure.
- `github-backlog.ts` - GitHub Issues as a Backlog, through an injected
  `CapturingRunner`. Pure over it.
- `graphql-cost.ts` - a GraphQL query's rate-limit cost. Pure.
- `file-backlog.ts` - `backlog.json` as a Backlog. Reads the file.
- `*.json`, `*.stderr` - recorded `gh` output the tests replay.

## Entry point

`index.ts`. Which Backlog a config selects is decided in `cli/open-backlog.ts`.

## May import

The core: `config`, `loop` (rate-limit errors), `ports`.
