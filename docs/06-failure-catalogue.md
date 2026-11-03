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
- **Cause, engine:** on timeout the engine sends SIGTERM to the `claude` process
  only, then waits for the child's `close` event, which waits for its output
  pipes. A grandchild (the shell loop) still holds the pipes, so `close` never
  comes. No process-group kill, no SIGKILL after a grace period.
- **Recovered by:** stopping the runner and the worker by hand, then opening
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

### A timed-out run leaves an empty log

- **Fix:** E: every run writes its iteration log, a timeout included, headed by
  the ticket, elapsed time and the signal that ended it, then the captured
  output (in place). Still to add: the branch, last commits, PR state and the
  last messages from the transcript.

### The worker gets no warning before the deadline

- **Fix:** E: pass the deadline to the worker; warn at most of the budget; grace
  period before the kill. S: check the deadline before any long wait; push the
  moment the gates are green.

## Running the loop

### The runner dies with the session

- **Seen:** a runner started with `setsid nohup` died when the supervising
  session restarted.
- **Fix:** E: a documented detached start (a service unit, or a supervisor
  outside the session). Toward the cloud roadmap item, state that does not live
  on one laptop.

### A watcher on the wrong process

- **Seen:** the supervisor watched the launcher's process id, which exits as
  soon as the runner starts, and reported the runner gone while it was working.
- **Fix:** S: find the runner's own process id after the start. E: write the
  runner's id to a file and expose it in `status`.

### A watcher that matches its own command

- **Seen:** a watcher grepping for "HALTED" in the log matched an old line and
  reported a halt that was not there.
- **Fix:** S: watch the HALT file's existence and lines written after the watcher
  started. E: a terminal-event file the watcher can poll.

### The engine finds no work while issues wait

- **Seen:** the engine reads only the backlog file. Issues labelled for the loop
  but not yet queued were not picked up, and the runner exited at once.
- **Fix:** P: the supervisor queues new issues in the backlog by PR as part of
  intake. E: adopt labelled issues itself, with their dependencies.

## The platform around it

### CI's default runner image moved

- **Seen:** after a repository move, CI jobs landed on a newer default Ubuntu
  image where the browser test tool could not install its browser. Every end to
  end job failed on work that was fine.
- **Fix:** P: pin runner images; a worker that hits an outside failure files a
  ticket and halts rather than retrying.

### The loop acted as the wrong account

- **Seen:** the CLI was signed in as a personal account, so the loop's merges and
  previews were attributed to it after the repository moved to an organisation.
- **Fix:** P: the loop's token is scoped to its own processes
  (`GH_TOKEN=$(gh auth token --user <account>)`); never switch the global
  account.

### Two test runs share one database

- **Seen:** parallel test runs on one machine locked the shared test database
  and failed unrelated tests.
- **Fix:** P: one test run at a time; S: never start a second commit while a
  hook's test run is going.

### An old stash popped by a shell error

- **Seen:** a before-and-after comparison used `git stash`; a shell glob error
  popped an unrelated old stash into the working tree.
- **Fix:** P: compare in a separate worktree, never with the stash.
