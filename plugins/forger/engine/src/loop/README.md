# loop

The unattended loop: start an iteration, spawn the worker, read the facts it
left, decide the outcome, apply it, and decide whether to go again.

## Files

Pure:

- `outcome.ts` - the outcome of a run, decided from facts, including whether it
  built the engine's pick, declined it, or took another ticket.
- `decline.ts` - what a decline record must hold, and how a run of declines
  becomes a halt.
- `claim.ts` - the worker's completion signal.
- `infra.ts` - an infrastructure failure or a rate limit, told from a worker
  failure.
- `prompt.ts` - the per-iteration prompt; it names the engine's pick, or says there is none.
- `iteration-log.ts` - the per-iteration log text.
- `status-report.ts` - the machine-readable status a supervisor acts on.
- `pr-checks.ts` - a PR's CI result folded from its check rollup.
- `merged.ts`, `run-facts.ts` - git facts, through an injected `CommandRunner`.
- `merge.ts` - merge a PR only once every check passed; the decision is pure,
  the waiting reads the PR through an injected `CommandRunner`.

Touch the world (their own files, the terminal, the clock):

- `runner.ts` - the outer loop: lock, halt, stall and failure limits, status and
  watch displays.
- `iteration.ts` - one iteration and the close-out of one a dead engine left open.
- `labels.ts` - the GitHub labels the loop relies on, declared once; creating the
  missing ones, and checking a decline's relabel from the issue's labels read back.
- `decline-io.ts` - the decline record file and the tracker calls that take a
  declined ticket out of the backlog, through the command port.
- `state.ts`, `lock.ts`, `events.ts`, `logger.ts` - the state file and HALT, the
  single-engine lock, the event file, the work log.

## Entry point

`index.ts`: `AutomationRunner` and the pure decisions above.

## May import

The core: `config`, `backlog` (the interface), `ports`.
