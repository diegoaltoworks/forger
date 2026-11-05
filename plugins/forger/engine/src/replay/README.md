# replay

Turns a stored set of owner requests into issues filed in order, so two forger versions can be run against the same work.

## Files

- `replay.ts` - the pure part. Reads the requests file, checks it, plans the issues in filing order and renders each body with its `Blocked by` section. No I/O.
- `run.ts` - `fileReplay`. Files the plan through an injected `CommandRunner` and links each blocker natively.

A request may only wait on one earlier in the set, so the order is always a valid filing order.

## Entry point

`index.ts`.

## May import

`backlog` (linking blockers), `ports`.
