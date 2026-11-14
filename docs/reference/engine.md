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

A worker's `stop`, plain or `stop conflict`, sets its ticket aside and does not
halt: the issue is labelled `needs-human` with the reason commented, a
`set_aside` event is recorded and the next pick skips tickets that share a
footprint with it. `limits.maxSetAside` set-asides in a row with no merge
between them halt the loop; a merge resets the count.

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

`measure` counts a run as covered when the events file holds a record of it of any kind, but counts owner interventions by terminal events only. When a run has no record the count is unknown: `measure --report` writes `owner_interventions` as `{total: null, by_event: {}, unknown_reason}`, and `measure --diff` gives a null delta for the total.

`measure --json` also reports `worker_denials` as `{total, by_rule, by_ticket}`: the `worker_denied` events of the runs in the period, the rule being the reason's text before its first colon. It is null, and the readable line says `unknown` with the reason, when the events file does not cover the period. The comparison report does not carry it.

`verify` and `merge` refuse, and record `engine_changed`, when the engine's own source still has uncommitted changes after waiting `limits.engineChangedWaitSeconds`. The loop halts on that event and sets no ticket aside.

A failed gate is run once more on the same head by `verify`; a pass records a
`flaky_gate` event (the check and the failed tests in `reason`) and files one
`flaky-gate` ticket, and `report` lists the flaky gates of the run.

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

The safety pack has a second periodic review of the same shape, the access
review. When `access_review.every_merged` in `.forger/safety.json` is above `0`
(absent or `0` is off, and off is the default) and that many tickets have merged
since the last `access_review_filed` event, the engine files one issue from
`.forger/templates/access-review.md`, labelled `access-review` and with the
intake label, and records `access_review_filed`. While an issue labelled
`access-review` is open no second one is filed. Each kind keeps its own count.

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


## Check records

Inside a worker (`FORGER_TICKET` set), the umbrella `check` appends one JSON line
per opinion that had a finding to `paths.checks`, under the loop's own root:
`{at, ticket, iteration, opinion, check, failed, waived}`. A run with no finding
appends one line with `clean: true` and no opinion. A failed write prints one
warning and never changes the exit code. A worker may not write the file itself.
