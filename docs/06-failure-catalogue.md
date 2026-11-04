# Failure catalogue

Failures seen in real runs of the loop, each with its cause, how it was
recovered, and where the lasting fix belongs: **E** the engine, **S** a skill
(worker or supervisor), **P** the per-repo process.

## The engine and the worker

### A worker hangs and the timeout never fires

- **Seen:** a worker waited for its own commit with
  `until ! pgrep -f "git commit"; do sleep 5; done`. The pattern matched the
  waiting shell's own command line, so the wait never ended. The 90-minute
  timeout fired, but the run went on for about 37 hours.
- **Cause, worker:** a wait on a process pattern that matches itself.
- **Cause, engine:** on timeout the engine sends SIGTERM to the agent process
  only, then waits for the child's `close` event, which waits for its output
  pipes. A grandchild (the shell loop) still holds the pipes, so `close` never
  comes. No process-group kill, no SIGKILL after a grace period.
- **Seen again:** an earlier hang of the same kind ran many hours past its
  timeout and nobody noticed: the run's log was empty, so nothing showed it was
  stuck or what it was doing. See "A timed-out run leaves an empty log" and
  "The worker gets no warning before the deadline".
- **Recovered by:** stopping the engine and the worker by hand, then opening
  the PR for the branch the worker had already pushed.
- **Fix:** E (in place): the worker is spawned as the leader of its own process
  group; on timeout the engine sends SIGTERM to the group, then SIGKILL after
  `limits.killGraceSeconds`, and resolves on `exit`, not `close`. S: never
  wait on a `pgrep -f` pattern; wait on a process id, or on the background job's
  own completion.

### A ticket marked completed before it merged

- **Seen, twice:** a worker set the ticket's status to `completed` in the
  working tree (and once in a pushed commit) and was then cut off. The engine
  read the working tree, counted the ticket done, and started the next one. Once
  that next ticket depended on the unmerged one.
- **Cause:** the backlog is read from the working tree; `completed` is written
  before the merge, not after it.
- **Recovered by:** resetting the status, and stopping a worker that had started
  on a base without its prerequisite.
- **Fix:** E: count a ticket completed only when its PR is merged (in place: a
  ticket that reads `completed` with nothing merged is reported and halts the
  loop, and is not counted as progress); still to do, read status from the
  base branch, not the working tree. S: the worker writes `completed`
  in the same squash as the merge, never before.

### A run that merged counts as a failure

- **Seen:** a worker merged its PR, then timed out writing its summary. The
  engine counted a consecutive failure.
- **Fix:** E (in place): every run's outcome is decided from facts (merged,
  pushed, nothing) before it is counted; a merge is a success whatever the
  exit.

### A red merge counted as completed

- **Seen:** a worker squash-merged its PR seconds after CI started, before the
  run finished; the run failed `check arch` on an import in a new test file, and
  the base branch went red. The engine counted the iteration as merged and
  completed, and the next ticket started on red.
- **Cause, checks:** `check arch` and `check docs` read only the files git
  tracks. The new test file was untracked when the worker ran the gates, so they
  passed locally on a tree that failed in CI once the file was committed.
- **Cause, worker:** the merge step was prose (watch the checks, read `facts`,
  then merge); the worker merged without waiting.
- **Cause, engine:** the outcome read whether a PR merged, never whether its
  checks had passed.
- **Recovered by:** the supervisor wrote a HALT; a later PR fixed the import.
- **Fix:** E: the checks scan untracked files too, so the local gates see what
  CI will. A worker merges only through `merge --pr <n>`, which waits for every
  check and refuses a red PR, and `check docs` fails a command file that spells
  out a raw merge. The outcome reads the merged PR's checks: a merge on failing
  or pending checks is `merged-red`, never completed, and halts the loop naming
  the PR and the failing check; one with no passing `verify` verdict for its
  head is `unverified` and halts the same way. S: read a gate's exit status, not the tail of
  its output, and run the gates again after the last edit.

### A worker merges its own PR by hand

- **Seen:** on several demo repositories, workers merged their own PRs with the
  CLI, despite a prompt that told them to merge only through the merge tool.
  Branch protection and the engine's `unverified` halt caught each one, but only
  after the code was on the base branch.
- **Cause:** the boundary was prompt text; nothing refused the call.
- **Fix:** E: the harness hook refuses a hand merge (the CLI's merge, and the
  merge endpoint through `gh api` or curl), a push to the base branch or a forced
  push, a status or check-run write, and an edit of the engine's state, before
  the call runs. Each refusal is a `worker_denied` event, so the supervisor sees
  it while the run goes on, and `check hooks` fails a project whose hook is
  missing or whose policy drops a default rule without a waiver.

### Adopting new work looks like a stall

- **Seen:** a run finished one ticket and adopted one new issue; the remaining
  count was unchanged, so the engine counted a stall.
- **Fix:** E (in place): progress is measured by merges, not by the remaining
  count.

### The log names a ticket the worker is not building

- **Seen:** the engine logs its own pick; the worker follows the owner's work
  order and builds something else.
- **Fix:** E (in place): the log names the ticket the worker took (from its
  branch) and labels the engine's pick when it differs. S: the supervisor reports the real branch.

### A worker overrides the engine's pick

- **Seen:** the engine named one ticket and the worker built another, from its
  own reading of the backlog or the owner's notes. The loop's order, its
  dependency checks and its budget tier were then not the ones the run used.
- **Cause:** the pick was advice in the prompt, and nothing held the run to it.
- **Fix:** E (in place): the prompt names the pick and the outcome decider marks
  a run that built a different ticket `off-pick`, which is never counted as
  progress. S: a worker that cannot build the pick runs `decline` with a reason
  (`blocked`, `too-large` or `unclear`), which records it, relabels the ticket
  and halts the loop on repeated declines. Check: `measure --json` reports the
  share of runs that were off-pick and the share declined over a window, so a
  rise in either shows up before it costs a ticket.

### A worker certifies its own acceptance

- **Seen:** the worker built a change, reviewed it in its own context and ticked
  the acceptance boxes; nothing independent checked that each criterion held.
  Gates and CI proved the code compiled and its tests passed, not that the
  ticket's words were met.
- **Cause:** "done" was a decision the model made about its own work.
- **Fix:** E (in place): `verify --pr <n>` runs a fresh-context verifier on the
  PR's head and records a verdict per criterion; `merge` refuses without a
  passing verdict for the current head, `handover` bounds the rounds and hands
  the criteria at fault to the owner, and a merge with no passing verdict is
  `unverified` and halts the loop. A criterion bound to a satisfied spec
  requirement with `[spec:ID]` is decided by the spec check and never reaches
  the verifier. Check: `measure --json` reports how often the verifier blocked
  a PR and how often a PR it passed later failed, so a verifier that earns
  nothing, or passes what breaks, shows up. See ADR 0010.

### A timed-out run leaves an empty log

- **Seen:** a run far past its timeout went unnoticed because its log held
  nothing: no ticket, no elapsed time, no sign of what it was waiting on.
- **Fix:** E: every run writes its iteration log, a timeout included, headed by
  the ticket, elapsed time and the signal that ended it, then the captured
  output (in place). Still to add: the branch, last commits, PR state and the
  last messages from the transcript.

### The worker gets no warning before the deadline

- **Fix:** E: pass the deadline to the worker; warn at most of the budget; grace
  period before the kill. S: check the deadline before any long wait; push the
  moment the gates are green.

### A worker failure and a platform failure look the same

- **Seen:** an expired login failed three runs in a few seconds and tripped the
  consecutive-failure halt. The halt said the worker kept failing; the cause was
  the platform.
- **Cause:** the engine counted every non-zero exit as a worker failure.
- **Fix:** E (in place): the exit is classified from its output (authentication,
  billing, network, a prompt that never reached the worker); an infrastructure
  error halts at once with its category and is not counted as a worker failure. S: a worker that meets an outside
  failure (a billing limit on CI, a package registry integrity error, an auth
  provider outage, a pull request waiting on an approval only a person can give)
  files a ticket and stops. It does not retry, and the halt is correct.

### A parallel start loses the prompt

- **Seen:** the first run with two workers halted on "too many consecutive
  failures" within a minute. The first worker said it received no stdin data
  and refused an empty prompt; the next two attempts logged git's "Preparing
  worktree" progress line as the error. None of it was the ticket's fault, and
  the halt then ended the healthy second worker.
- **Cause:** the prompt was written to the worker's stdin pipe, which the
  event loop feeds. Starting the second worker runs synchronous git and gh
  calls that block the loop, long enough for the first worker to stop waiting
  for its prompt. A retry then failed on the branch the first attempt had left
  behind, and the error shown was the first line of git's stderr, its progress
  message, not the `fatal:` line after it. Both counted as worker failures.
- **Fix:** E (in place): the prompt is written to a file synchronously and the
  file is the worker's stdin, so a blocked event loop cannot starve it; a
  prompt that cannot be written, or a worker that reports it got none, is an
  infrastructure error (delivery). A worktree is failed only by a non-zero
  exit, its error is git's `fatal:` or `error:` line, and a retry checks out the
  branch an earlier attempt left. A worktree that cannot be made is an
  infrastructure error too: it halts at once, naming the cause, and is not
  counted as a worker failure.

### The tracker's rate limit reads as a dead tracker

- **Seen:** the loop stopped with "gh returned nothing (not authenticated, or
  offline?)". The login was fine; GitHub's hourly GraphQL budget was spent.
- **Cause:** the backlog query asked for large pages nested two deep and paged
  through every closed issue, and the engine, each worker and the supervisor
  read it several times an iteration. The engine dropped `gh`'s stderr and
  guessed at the cause.
- **Fix:** E (in place): the query's worst-case cost is computed from its text
  and held to a budget by a test; closed issues are read only as far as the
  most recent; the engine reads the backlog once per iteration. A rate-limited
  read is an infrastructure error that names the limit and its reset; the
  engine waits for the reset and does not count it against the ticket. Any
  other empty read quotes `gh`'s stderr.

### Clearing a HALT does not stick

- **Seen:** the owner cleared the HALT file; seconds later the engine wrote it
  again.
- **Cause:** the counters that tripped the halt (consecutive failures, stall)
  survived the clear, so the first run after it tripped them again.
- **Fix:** E (in place): clearing a HALT also resets the counters and the halted
  status, in the same step. S: only the owner clears a HALT; the supervisor
  never resets counters by hand.

### Every engine start logs a false stall

- **Seen:** a fresh start logged a stall before doing any work.
- **Cause:** progress was read as a drop in the remaining count, which cannot
  drop on a first run.
- **Fix:** E (in place): progress is a merge, so a start has no stall to report
  (see "Adopting new work looks like a stall").

### Local-only files count as a dirty tree

- **Seen:** a worker left a local settings file or the work order modified, and
  the run was counted as a failure for a dirty tree.
- **Cause:** the merge check treated every modified path alike.
- **Fix:** E (in place): paths the engine owns (state, log, output, HALT, lock,
  events, declined, verdicts) and the configured `local_only` list are ignored when checking the
  tree. P: list files that stay local in `local_only`.

### An engine restarted mid-iteration re-runs the ticket

- **Seen:** the engine was restarted while an iteration was open and ran the
  same ticket again, on top of a branch the first run had already pushed.
- **Cause:** the open iteration was never closed out; the new run started from
  the ticket list alone.
- **Fix:** E (in place): an engine takes a lock, so only one runs at a time; on
  start an iteration left open by a dead engine is closed out from git facts
  (merged, pushed, nothing) before anything new begins.

### The engine exits "all tasks completed" while work remains

- **Seen:** the engine reported everything done while the owner's work order
  still listed work.
- **Cause:** "done" was read from the engine's own backlog, which did not hold
  what the work order held (new issues not yet adopted, tickets the filter
  hid).
- **Fix:** E (in place): the exit keys off the count of tickets not completed,
  not off the count the engine can start now, and adopts labelled issues first.
  S: the supervisor compares the work order with `backlog --json` before it
  believes the exit (roadmap: the work supervisor).

### Two workers start together and one gets no prompt

- **Seen:** the first run with two workers halted within a minute. The first
  worker exited at once with "Input must be provided either through stdin or as
  a prompt argument"; its retries failed on git's "Preparing worktree" progress
  line, logged as an error; the third failure halted the loop and ended the
  healthy second worker.
- **Cause:** the prompt write to the worker's stdin was not awaited or checked,
  stderr output was read as failure, and infrastructure errors counted toward
  the consecutive-failure limit.
- **Recovered by:** the owner clearing the HALT.
- **Fix:** E: #205: an awaited, checked prompt write; failure only on a non-zero
  exit; infrastructure errors kept out of the failure count.

## The verifier

### The verifier cannot run the code it judges

- **Seen:** the verifier answered `cannot_tell` on "a test reproduces the bug"
  and "gates green", because its checkout was read-only and the install failed.
  On another repository it copied the checkout to a temporary directory on its
  own initiative; the result depended on what it thought of.
- **Recovered by:** the supervisor running the gates on the PR head in a
  separate worktree and posting the result on the PR for the owner.
- **Fix:** E: #190: a writable copy with dependencies installed and the gates,
  `check` and `screenshot` already run, so the model judges criteria, not
  whether the tests pass.

### The verifier answers "can't tell" with no reason

- **Seen:** a criterion came back `cannot_tell` with no evidence and no reason,
  and the loop handed the owner a halt with nothing to act on.
- **Fix:** E: #193: `cannot_tell` must name what was missing, and the engine
  re-checks the evidence behind every `met`.

### The verifier passes a screen that is visibly wrong

- **Seen:** an empty list showed a filter banner with no filter active; a
  "desert" preset rendered green; a 3D view was cut off at the bottom. Gates,
  checks and the verifier passed each; a person looking at the screenshots
  caught them.
- **Cause:** screenshots were taken but nothing compared them with the ticket's
  UI states.
- **Fix:** E: #189 (the verifier checks screenshots against the UI states), #194
  (mechanical assertions per state), #195 (approved baselines).

### A UI state the screenshot tool cannot reach

- **Seen:** a fix for an empty-state bug was refused twice because its ticket
  asked for a screenshot of the filtered list, and `screenshot` captures routes
  only.
- **Recovered by:** the owner waiving the screenshot criterion.
- **Fix:** E: #191: named states in `ui.json`, with steps run before capture.

### A vague or unsourced criterion decides the outcome

- **Seen:** "relief sharpens" was read one way by the worker and another by the
  verifier. A threshold the supervisor set without a source was tighter than the
  reference data's own error, and blocked correct work.
- **Recovered by:** restating both criteria with measured, sourced thresholds;
  the reworked PRs passed.
- **Fix:** E: #196: `check ticket` refuses a criterion that is not a test, a
  command with its result, a sourced number or a named UI state. S: spikes record
  a thresholds table with sources, and build tickets cite it.

## Running the loop

### The engine dies with the session

- **Seen:** an engine started with `setsid nohup` died when the supervising
  session restarted. Seen again with several loops: the engines and the
  supervisor's watchers ended in the same second while the workers ran on,
  orphaned, and finished with no engine to verify their PRs.
- **Recovered by:** waiting for each orphaned worker to exit, then starting the
  engine as a user service (`systemd-run --user --unit=forger-loop-<repo>`),
  which no session owns.
- **Fix:** E: a documented detached start (a service unit, or a supervisor
  outside the session). Toward the cloud roadmap item, state that does not live
  on one laptop.

### A watcher on the wrong process

- **Seen:** the supervisor watched the launcher's process id, which exits as
  soon as the engine starts, and reported the engine gone while it was working.
- **Fix:** S: find the engine's own process id after the start. E: write the
  engine's id to a file and expose it in `status`.

### A watcher that matches its own command

- **Seen:** a watcher grepping for "HALTED" in the log matched an old line and
  reported a halt that was not there.
- **Fix:** S: watch the HALT file's existence and lines written after the watcher
  started. E: a terminal-event file the watcher can poll.

### A watcher's pipe holds back the event that matters

- **Seen:** a hand-built watcher piped the event file through `cut`, which
  buffered its output; a loop halted and the supervisor did not hear of it until
  it looked. Another watcher polled `status` without the loop's token and read
  every repository as missing.
- **Fix:** S: watch with `await-event` alone, one per loop, with the loop's
  identity in its environment; no shell pipelines. E: #199: `watch --repos`
  follows several loops with unbuffered, tagged lines.

### A supervisor kills its own shell

- **Seen:** the supervisor ran `pkill -f` on a pattern that also matched its own
  command line, and killed its own shell. The same self-match hung a worker's
  wait (see the first entry).
- **Fix:** S: never `pkill -f` or `pgrep -f` on a pattern that can match the
  command that carries it; act on a process id taken from the engine's pid
  file. E: `status --json` reports that id.

### Background work reports done before its files exist

- **Seen:** a completion notice for background work arrived before the files,
  the log or the PR checks it announced were there, and the supervisor acted on
  the notice.
- **Fix:** S: treat the notice as a prompt to look, not as a fact; read the
  files, the log and the PR checks directly. E: a watcher reads the terminal-event file and
  `status --json`, which come from the engine, not from the worker's report.

### The engine finds no work while issues wait

- **Seen:** the engine reads only the backlog file. Issues labelled for the loop
  but not yet queued were not picked up, and the engine exited at once.
- **Fix:** P: the supervisor queues new issues in the backlog by PR as part of
  intake. E: adopt labelled issues itself, with their dependencies.

## The platform around it

### A rule held only in a memory note is broken again

- **Seen:** a rule written into a memory note was broken five times by workers
  that had the note loaded.
- **Cause:** a note is advice to a model, and a model weighing it against the
  task can lose.
- **Fix:** the refinement ladder: a rule that keeps breaking climbs from note to
  a hook or a check, and ends as a tool (see
  [05-refining-the-process.md](05-refining-the-process.md)). `check docs` is the
  example for prose rules.

### A hook rejects late and the rejection is missed

- **Seen:** a commit-message hook rejected a word only after minutes of
  pre-commit gates, and the one-line rejection was easy to miss in the output.
- **Fix:** P: run the cheap checks first, so a rejection comes in seconds; a
  check that can run on the message alone runs before the gates. S: after every
  commit, confirm it exists before moving on.

### Knock-on test failures found one CI run at a time

- **Seen:** a change broke tests elsewhere; each CI run revealed one more, and
  the repeated runs caused timeouts.
- **Fix:** P: impact analysis up front (what imports or reads what changed), and
  run only the affected tests locally before pushing. The time budget is not
  raised to absorb a slow loop.

### CI's default `runs-on` image moved

- **Seen:** after a repository move, CI jobs landed on a newer default Ubuntu
  image where the browser test tool could not install its browser. Every end to
  end job failed on work that was fine.
- **Fix:** P: pin the `runs-on` images; a worker that hits an outside failure files a
  ticket and halts rather than retrying.

### The loop acted as the wrong account

- **Seen:** the CLI was signed in as a personal account, so the loop's merges and
  previews were attributed to it after the repository moved to an organisation.
- **Seen again:** other loops on the same machine shared the global account, so
  an engine started without a scoped token acted as the wrong one.
- **Fix:** P: the loop's token is scoped to its own processes
  (`GH_TOKEN=$(gh auth token --user <account>)`); never switch the global
  account.

### Two test runs share one database

- **Seen:** parallel test runs on one machine locked the shared test database
  and failed unrelated tests.
- **Fix:** P: one test run at a time; S: never start a second commit while a
  hook's test run is going.

### Setup misreads a new repository

- **Seen:** every new demo repository hit a setup bug: `~/.claude` taken as the
  project root, an absolute home path written into the gates, `bun test` and
  pytest in `pyproject.toml` not detected, and coverage left without the lcov
  report the testing pack reads.
- **Recovered by:** creating `.forger` before setup, rewriting the gates with
  `$HOME`, and adding the coverage flags by hand.
- **Fix:** E: #183, #184, #185, #186, and #197: setup run against sample
  projects in CI, so a setup bug fails a PR.

### Branch protection lost when a repository moves

- **Seen:** moving the demo repositories to an organisation dropped their branch
  protection, so the required gates check was gone until it was put back.
- **Fix:** S: after a transfer, re-apply protection and read it back before any
  loop starts. E: `orient` reports a base branch that does not require
  `forger/verify` (#187); the same check covers the gates check.

### A guard that matches text refuses harmless commands

- **Seen:** a stopgap hook that refused hand merges matched the merge command
  anywhere in the command line, and refused an issue comment whose body quoted
  it.
- **Fix:** E: #192's hook tests the parsed program and arguments, split on `&&`,
  `;` and `|`, with `env` and assignments stripped. S: post long text from a file.

### An old stash popped by a shell error

- **Seen:** a before-and-after comparison used `git stash`; a shell glob error
  popped an unrelated old stash into the working tree.
- **Fix:** P: compare in a separate worktree, never with the stash.
