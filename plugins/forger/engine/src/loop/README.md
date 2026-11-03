# loop

The unattended loop: start an iteration, spawn the worker, read the facts it
left, decide the outcome, apply it, and decide whether to go again.

## Files

Pure:

- `outcome.ts` - the outcome of a run, decided from facts.
- `claim.ts` - the worker's completion signal.
- `infra.ts` - an infrastructure failure or a rate limit, told from a worker
  failure.
- `prompt.ts` - the per-iteration prompt.
- `iteration-log.ts` - the per-iteration log text.
- `status-report.ts` - the machine-readable status a supervisor acts on.
- `merged.ts`, `run-facts.ts` - git facts, through an injected `CommandRunner`.

Touch the world (their own files, the terminal, the clock):

- `runner.ts` - the outer loop: lock, halt, stall and failure limits, status and
  watch displays.
- `iteration.ts` - one iteration and the close-out of one a dead engine left open.
- `state.ts`, `lock.ts`, `events.ts`, `logger.ts` - the state file and HALT, the
  single-engine lock, the event file, the work log.

## Entry point

`index.ts`: `AutomationRunner` and the pure decisions above.

## May import

The core: `config`, `backlog` (the interface), `ports`.
