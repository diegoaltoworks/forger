# The engine

How the engine decides a run's outcome, recovers and stops. The commands are in
[`commands.md`](commands.md).

## How the engine runs

Each run's outcome is decided from git, not from the worker's exit code or its
own completion signal: the base branch moved on the remote (merged), the
worker's branch is on the remote (pushed), or neither. A run that merged and
then timed out is a success; a merge whose PR checks had failed or not finished
is `merged-red`, never a success, and halts the loop naming the PR and the
failing check; a run that claimed completion and merged nothing is a failure; a
ticket the backlog reads `completed` with nothing merged halts the loop for
recovery. The ticket a run is held to is the one the worker took,
read from its branch, which the log names when it differs from the engine's
pick.

A run that exits non-zero with an authentication, billing, network or sandbox-limit error is
an infrastructure error, not a worker failure: the loop halts at once with the
reason and the failure counter is left alone. A tracker read refused by
GitHub's rate limit is one too, naming the limit and its reset time (from
`gh api rate_limit`); the engine waits for the reset and carries on, never
charging the wait to a ticket. `resume` requires `--cause <issue>` (with a GitHub tracker the issue must exist)
or `--not-a-defect "<why>"`; with neither it exits non-zero and clears nothing.
It clears the HALT and zeroes the failure and stall counters, so the first run
after a fix starts clean, and the first run after any start is never counted as
a stall. The failure is not lost: `halt_cleared` records the last error beside
the `cause` or `not_a_defect`, and both are null when the halt label was removed
by hand. `measure` counts clears with a cause, as not a defect and with no
reason; `report` lists each uncaused clear under waiting on you.

One engine works a repo at a time. `run` writes its pid to the lock file and
refuses to start while that pid is alive; a lock whose pid is dead is taken
over. If the previous engine died mid-iteration, the new one first closes that
iteration out, deciding its outcome from git as for any run, and only then
picks a ticket, so a ticket is not re-run blindly. Each terminal event
(completed, halted, stalled, timed out, too many failures, engine gone) appends
one JSON line to the event file, and `status --json` reports the engine, halt,
counters, current ticket and next pick, so a supervisor reads files and commands
rather than human text.

Each merged ticket appends a `merged` event. When a project has the structure
pack, the engine then counts the merges since the last `structure_review_filed`
event and the entries in the structure baseline. Reaching `review.every_merged`
merges, or having more than `review.warnings_over` entries, files one
whole-repo structure review from `.forger/templates/structure-review.md`, labelled
`structure-review` and with the intake label, and appends a
`structure_review_filed` event whose reason says which trigger fired. While an
issue labelled `structure-review` is open no second one is filed, and a
threshold of `0` turns its trigger off. Filing is the `file_tickets` action,
which needs no approval.

A ticket's `## Probe` section lists commands, each with its expected result in
the forms of acceptance criteria. Before a worker starts, the engine runs each
on the host in the directory the worker would start in, with the run's timeout
and no model, and stops at the first that fails. When all hold, their output
goes into the worker's prompt. When one fails, no worker starts: the engine
labels the issue `needs-human`, comments the command with the expected and the
actual result, takes it off the Backlog, records a `probe_failed` event and
picks the next ticket. A failed probe is neither a worker failure nor a stall,
and it halts nothing.

The loop stops when the backlog empties, a HALT file appears, it stalls (nothing
merged for `maxStallIterations` runs in a row), or it hits
`maxConsecutiveFailures`.

