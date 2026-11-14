# loop

The unattended loop: start an iteration, spawn the worker, read the facts it
left, decide the outcome, apply it, and decide whether to go again.

## Files

Pure:

- `outcome.ts` - the outcome of a run, decided from facts. It tells whether
  the run built the engine's pick, declined it, or took another ticket.
- `aside/` - a worker's stop sets its ticket aside (ADR 0020). See its README.
- `delivery/` - runs the delivery pack's commands after a merge. See its README.
- `decline.ts` - what a decline record must hold, and how a run of declines
  becomes a halt.
- `absolute-rule.ts` - warns when a ticket with UI states states an absolute design rule and carries no measured number.
- `criteria.ts` - what makes an acceptance criterion checkable. It may be a
  named test, a command with its result, a sourced number or a named UI state.
  It also finds the subjective words that fail a criterion.
- `claim.ts` - the worker's completion signal.
- `infra.ts` - tells an infrastructure failure or a rate limit from a worker
  failure.
- `prompt.ts` - the per-iteration prompt. It names the engine's pick, or says
  there is none.
- `lease.ts` - the cross-machine lease (ADR 0015). It acquires, renews and
  refuses the lease, or takes over an expired one, with the clock passed in.
  A lease this machine holds for a pid that is gone counts as expired.
  `viewLease` is what `orient` reports.
- `runner.ts` takes, renews and releases the lease when the config puts the
  state on the branch. It also releases on SIGTERM and SIGINT.
- `reviews/` - the periodic whole-repo reviews.
  - `schedule.ts` - what every kind shares.
  - `structure-review.ts` - when a structure review is due.
  - `access-review.ts` - when an access review is due.
  - The `-io` files file them.
- `state.ts` - the loop state record and `LoopStore`, which persists it
  through the `StateStore` port.
- `halt-label.ts` - decides HALT from the `halted` label and the local HALT
  file. It also builds the status body for the pinned loop issue (ADR 0015).
- `iteration-log.ts` - the per-iteration log text.
- `status-report.ts` - the machine-readable status a supervisor acts on.
- `pr-checks.ts` - a PR's CI result, folded from its check rollup.
- `verdict.ts` - the verifier's verdict (ADR 0010). It parses acceptance
  criteria from the issue. A validator holds a verdict to them, with evidence
  resolution injected. A reducer gives `pass`, `block` or `unclear`.
- `verify-input.ts` - what the verifier gets: criteria, diff and gate result,
  never the worker's claims. It also holds the tier the verifier runs on. It
  reads the reply into a verdict record. Invalid output is recorded
  `cannot_tell` for every criterion.
- `scratch.ts` - the disposable checkout folders of `verify` and `critique`.
  They sit under `paths.tmp`, never in the system temp folder. It tells an
  out-of-space failure (`ENOSPC`, `EDQUOT`) apart and names the folder's free
  space.
- `verdict-store.ts` - reads verdict records and owns their one home. That home
  is the main checkout's `paths.verdicts`, found through the git directory a
  worktree shares with it. A record outlives the worktree. A merged head with no
  record counts as passed when it carries a `forger/verify` status of success.
- `worktree.ts` - a worktree per ticket, and the rebase of its branch on the
  base (ADR 0011). Names are pure. Git calls go through an injected capturing
  `CommandRunner`.
- `worktree-workspace.ts` - the workspace half of a `Sandbox` as a git worktree, which the engine uses when
  no sandbox is given.
- `parallel.ts` - the parts of the parallel loop that decide or compose
  (ADR 0011). It holds the git calls aimed at a worktree and the folder map
  the scheduling rule reads. It also holds the conflict check after a worker's
  one attempt, and the clean-up that drops a conflicted branch.
- `worker-env.ts` - the role, ticket, iteration and worktree the engine puts in a
  worker's environment. The harness hook reads them back.
- `merged.ts`, `run-facts.ts` - git facts, through an injected `CommandRunner`.
- `merge.ts` - merges a PR only once every check passed. The decision is pure.
  The wait reads the PR through an injected `CommandRunner`.

Touch the world (their own files, the terminal, the clock):

- `verify.ts` - `verify --pr`. It makes a writable throwaway copy of the PR
  head with dependencies installed. It runs the verifier through the
  `AgentRunner`. It writes the record per PR and head commit.
- `runner.ts` - the outer loop: lock, halt, stall and failure limits, status
  and watch displays.
- `halt-tracker.ts` - the `halted` label and status body on the pinned loop
  issue, through the command port. A failed read means "not halted".
- `iteration.ts` - one iteration, and the close-out of one a dead engine left
  open.
- `labels.ts` - the GitHub labels the loop relies on, declared once. It creates
  the missing ones. It checks a decline's relabel from the issue's labels read
  back.
- `ticket-check.ts` - refuses workable tickets whose criteria cannot be
  checked, before a pick. They leave the backlog as `needs-info`, with the
  failing criteria named.
- `decline-io.ts` - the decline record file. Also the tracker calls that take
  a declined ticket out of the backlog, through the command port.
- `state.ts`, `lock.ts` - the state file with HALT, and the lock of the single
  engine.
- `events.ts`, `schedule-log.ts`, `logger.ts` - the event file, the file of
  scheduling decisions and the work log.

## Entry point

`index.ts`: `AutomationRunner` and the pure decisions above.

## May import

The core: `config`, `backlog` (the interface), `ports`.
