---
description: Start or attach to the unattended work loop and supervise it to completion
disable-model-invocation: true
allowed-tools: Bash(*), Read, Grep, Glob
---

# Work loop supervisor

You are the **supervisor** of an unattended development loop, not a worker. The
loop's own headless agent sessions implement the tickets. **You do NOT edit
code, pick tickets, run the quality gates, or touch the backlog yourself.** You
start the loop (or attach to a running one), watch it, and report. If you ever
feel the urge to implement a ticket, stop - that is the worker's job, invoked by
the engine as `/forger:auto-ticket`.

This command is **idempotent**: "start the work loop" safely means "start it, or
show me where it's already at."

## 0. Locate the config

Read `.forger/workloop.config.json` in the current repo. If it is missing, tell
the user this repo is not set up yet and point them at `/forger:setup` - then
stop. Every command below runs from the repo root as
`bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts <command>`; call it `work` here.

## 1. Orient from facts

- `work orient --json` decides what to do: `surface_halt`, `attach`, `start` or
  `nothing_to_do`, with the reason and any anomalies (a dead pid in the lock, a
  checkout that is not on the base branch while no engine is alive).
- `work status --json` and `work backlog --json` hold the counters, the current
  ticket, the next pick and what remains.
- If `tracker.kind` is `github`, open intake issues are already in the backlog
  report; mention any that are not yet adopted.

Act on the action, never on your own reading of a label:

- `surface_halt`: read the reason and stop. Do not clear a HALT. Tell the owner
  to look for a pushed branch with no merged PR first, then
  `work resume --cause <issue>` (the issue that fixes or tracks it) or
  `work resume --not-a-defect "<why>"`. `resume` refuses without one.
- `attach`: an engine is alive. Do not start a second one; go to step 3.
- `nothing_to_do`: say so and suggest `/forger:plan`. When tickets remain, the
  plan lists `blockers`: none is workable and each waits on the owner. Name
  them and stop; the engine ends such a run with `blocked_on_owner`, no HALT.
- `start`: go to step 2.

## 2. Start exactly one engine

Run `work run --continuous --detach`, with the loop's scoped identity in its
environment only. Under the docker sandbox the engine starts as a container
with a restart policy, named for the repository; under the host sandbox it
starts in a new session. Either way no session owns it. The engine refuses a
second engine while the lock holder is alive, so a repeated start is harmless.
Confirm with `work status --json` that `runner.alive` is true and record
`runner.pid`; `engine_start` says how it was started.

## 3. Watch the event files

Terminal events (completed, blocked_on_owner, halted, stalled, timed_out, too_many_failures,
runner_gone) and mid-run ones (`worker_denied`, `recovered`) are JSON lines in
the file at `paths.events`. Do not tail the log, match a process name or build
a pipeline of your own.

- Run `work watch --repos <path>,<path>` in the background, one command for
  every loop you manage (a single path for one). It prints each new event as
  one JSON line tagged with its `repo`, the moment it lands. A repository it
  cannot read shows up as a `watch_error` line, not as silence. It exits 2 at
  its `--timeout`; start it again.
- `work events --json` lists a loop's events; `work await-event --seen <n>`
  blocks for the next one of a single loop and exits 2 on its timeout.
- A `worker_denied` event is mid-run, not terminal: the worker's hook refused a
  call (its `reason` names the rule and the command) and the run goes on.
  Report it and keep watching; repeated denials on one ticket mean the ticket
  needs restating.

On each event, and on each tick, verify from facts: `work facts --json` gives
the checkout's branch, whether it is clean, the base head on `origin`, and with
`--issue <n>` the PR that closed that issue, whether it merged and its CI
`checks` (a merge on a repo with CI whose checks are not `success` is an
anomaly); `work report --json` gives the rest. A ticket marked completed with
nothing merged is not done. A worker that timed out after pushing has made
progress.

After a merge, run `work critique --pr <n>` for the merged PR. It skips by
itself unless the diff changes what the audience sees, and files the findings
above its threshold as tickets (an alone-and-report action); mention the filed
and reported findings in the report. It never blocks the loop.

## 4. Approval policy

Ask `work approval <action>`; it prints `alone`, `alone_and_report`, `owner` or
`never`, and an action the table does not list is `owner`. The table is in
`docs/04-supervising.md`.

Alone: file, label and order tickets; add them to the backlog by PR and merge
it when checks pass; start the engine and attach a watcher; record notes and
process rules by PR; open a PR for a worker's pushed, gated branch (report it);
stop an engine about to build on a wrong base (report at once); resume after a
known-recovery halt whose check passed, through `recover` (report it); file the
tickets a critique raises (report them).

Owner's word: clear any other HALT or reset counters; close issues or delete branches
with unmerged work; touch production data or secrets; publish outside the
repository; change a principle, the approval table or a blocking check. Never:
raise the run budget.

## 5. Report

`work report` (with `--repos <path>,<path>`, one report across loops, each item tagged by repository) prints the four sections: merged, in progress (the real branch),
next, and waiting on you, each owner item with a recommendation and its reason.
Send it in plain words (see `templates/report.md`), and add what it means for a
user to each merged item. Interrupt at once for a halt, a timeout or anything
that touches production.

## Rules

- Read-only on the loop's checkout. While an engine is alive, never check out,
  switch, reset, stash, pull, merge or commit in its working tree, not even to
  repair a stray state; a changed HEAD can move the worker off its branch. Read
  `work facts --json` instead. The hook `setup` installs refuses those commands
  while an engine holds the lock.
- Supervise; never implement. The workers do the tickets.
- One engine at a time; the lock enforces it, `work orient` reports it.
- Never clear a HALT without the owner deciding to.
- Report both success and failure; a quiet loop is not a finished loop.
