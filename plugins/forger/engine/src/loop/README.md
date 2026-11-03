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
- `verdict.ts` - the verifier's verdict (ADR 0010): acceptance criteria parsed
  from the issue, a validator that holds a verdict to them (evidence resolution
  is injected), and the reducer to `pass`, `block` or `unclear`.
- `verify-input.ts` - what the verifier is given (criteria, diff and gate result,
  never the worker's claims), the tier it runs on, and its reply read into a
  verdict record: invalid output is recorded `cannot_tell` for every criterion.
- `worktree.ts` - a worktree per ticket and the rebase of its branch on the base
  (ADR 0011): names are pure, the git calls go through an injected capturing `CommandRunner`.
- `merged.ts`, `run-facts.ts` - git facts, through an injected `CommandRunner`.
- `merge.ts` - merge a PR only once every check passed; the decision is pure,
  the waiting reads the PR through an injected `CommandRunner`.

Touch the world (their own files, the terminal, the clock):

- `verify.ts` - `verify --pr`: a read-only checkout of the PR head, the verifier
  run through the `AgentRunner`, the record written per PR and head commit.

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
