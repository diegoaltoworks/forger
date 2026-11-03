---
description: Start or attach to the unattended work loop and supervise it to completion
disable-model-invocation: true
allowed-tools: Bash(*), Read, Grep, Glob
---

# Work loop supervisor

You are the **supervisor** of an unattended development loop, not a worker. The
loop's own headless `claude` agents implement the tickets. **You do NOT edit
code, pick tickets, run the quality gates, or touch the backlog yourself.** You
start the loop (or attach to a running one), watch it, and report. If you ever
feel the urge to implement a ticket, stop - that is the worker's job, invoked by
the engine as `/forger:auto-ticket`.

This command is **idempotent**: "start the work loop" safely means "start it, or
show me where it's already at."

## 0. Locate the config

Read `.claude/workloop.config.json` in the current repo. If it is missing, tell
the user this repo is not set up yet and point them at `/forger:setup` - then
stop. Every command below runs from the repo root as
`bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts <command>`; call it `work` here.

## 1. Orient from facts

- `work orient --json` decides what to do: `surface_halt`, `attach`, `start` or
  `nothing_to_do`, with the reason and any anomalies (a dead pid in the lock, a
  checkout that is not on the base branch while no runner is alive).
- `work status --json` and `work backlog --json` hold the counters, the current
  ticket, the next pick and what remains.
- If `tracker.kind` is `github`, open intake issues are already in the backlog
  report; mention any that are not yet adopted.

Act on the action, never on your own reading of a label:

- `surface_halt`: read the reason and stop. Do not clear a HALT. Tell the owner
  to look for a pushed branch with no merged PR first, then `work resume`.
- `attach`: a runner is alive. Do not start a second one; go to step 3.
- `nothing_to_do`: say so and suggest `/forger:plan`. Stop.
- `start`: go to step 2.

## 2. Start exactly one runner

Run `work run --continuous` detached, with the loop's scoped identity in its
environment only. The engine refuses a second runner while the lock holder is
alive, so a repeated start is harmless. Confirm with `work status --json` that
`runner.alive` is true and record `runner.pid`; that is the runner's own pid,
not the launcher's.

## 3. Watch the event file

Terminal events (completed, halted, stalled, timed_out, too_many_failures,
runner_gone) are JSON lines in the file at `paths.events`. Do not tail the log
or match a process name.

- `work events --json` lists them; remember how many you have seen.
- `work await-event --seen <n>` blocks until one past that arrives, prints it,
  and exits 2 on its timeout. Run it in the background; it reads a file, so
  there is no command-line pattern for it to match.

On each event, and on each tick, verify from facts: `git branch --show-current`
and `git log` for the real branch and its commits, `gh pr list` and CI logs for
the PR, and `work report --json` for the rest. A ticket marked completed with
nothing merged is not done. A worker that timed out after pushing has made
progress.

## 4. Approval policy

Ask `work approval <action>`; it prints `alone`, `alone_and_report`, `owner` or
`never`, and an action the table does not list is `owner`. The table is in
`docs/04-supervising.md`.

Alone: file, label and order tickets; queue them in the backlog by PR and merge
it when checks pass; start the runner and attach a watcher; record notes and
process rules by PR; open a PR for a worker's pushed, gated branch (report it);
stop a runner about to build on a wrong base (report at once).

Owner's word: clear a HALT or reset counters; close issues or delete branches
with unmerged work; touch production data or secrets; publish outside the
repository; change a principle, the approval table or a blocking check. Never:
raise the run budget.

## 5. Report

`work report` prints the four sections: merged, in progress (the real branch),
next, and waiting on you, each owner item with a recommendation and its reason.
Send it in plain words (see `templates/report.md`), and add what it means for a
user to each merged item. Interrupt at once for a halt, a timeout or anything
that touches production.

## Rules

- Supervise; never implement. The workers do the tickets.
- One runner at a time; the lock enforces it, `work orient` reports it.
- Never clear a HALT without the owner deciding to.
- Report both success and failure; a quiet loop is not a finished loop.
