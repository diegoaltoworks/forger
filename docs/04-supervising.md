# Supervising

The supervisor walks the same layers every session, in order, and reports
against them. Improvising each session is what this replaces.

## 0. First run: settle the owner's choices

Asked once, written down, refined later (see `05-refining-the-process.md`):

- **Reporting:** cadence, timezone, channel, and what interrupts immediately.
- **Intake policy:** what may be filed without asking; whether to investigate
  code and logs first (yes); the default label for a spike's build tickets.
- **Approval policy:** what needs the owner (clearing a HALT, resetting counters,
  killing processes, data in production, anything outward-facing) and what the
  supervisor may do alone (filing, ordering, starting the engine, merging
  supervisor PRs that touch only the backlog or the process docs).
- **Budget and speed rules:** per-ticket time and money, and the rule that the
  budget is not raised.
- **Ticket template and writing rules:** sections, punctuation, banned words,
  documentation discipline.
- **Sources:** tracker, CI, deploy, logs, design artifacts.
- **Identity:** which account the loop acts as, and how its token is scoped to
  the loop's processes only.

## 1. Orient

- Read the playbook, the open owner questions and the memory notes.
- Engine status, the HALT file, whether an engine is alive.
- What merged since the last session; what the checked-out branch really is.
- Anything stuck: a ticket marked completed with no merged PR, a branch with
  commits and no PR.

## 2. Intake

For each owner message:

1. Investigate: read the code, find the likely cause, check logs and the deploy.
2. File the issue by the template, labelled.
3. If the request implies a standing rule ("from now on every ticket..."), it is
   two things: the ticket, and a process change (step 8).
4. Answer the owner with the issue link and the defaults chosen, and ask only
   the questions that change the work, each with a recommendation.

## 3. Order

- Add new tickets to the backlog by PR, with `depends_on` wherever order
  matters.
- Update the work order with one explicit line: which ticket is next, and what
  waits for what. Vague wording ("finish X") has been misread; name the ticket.
- Confirm the engine's next pick matches the order.

## 4. Dispatch

- Exactly one engine, started detached so it survives the session, with the
  loop's identity scoped to its environment.
- Record the engine's real process id, not its launcher's.
- Arm a watcher on terminal events: completed, HALT, stalled, timed out, too
  many failures, engine gone. The watcher must not match its own command line.

## 5. Watch and verify

On each tick, from facts, not from labels:

- The checked-out branch, its commits, the working copy.
- The PR and CI, reading failures from CI's own logs.
- The merge reaching production (a ready deploy).
- The counters.

Act on anomalies by the approval policy. A worker that timed out after pushing
has made progress; a ticket marked completed with nothing merged is not done.
Verify each merge against its PR's CI result: `facts --json --issue <n>` gives
the closing PR's `checks`. A merge whose checks are anything but `success`, on a
repo with CI, is an anomaly: the worker merged red or did not wait. The engine
makes the same check after every run and halts with `merged_red`.

## 6. Sync

After a merge that changes design artifacts, sync them to wherever the owner
reviews them, merging any edits made there, and record the commit synced to.

## 7. Report

In plain words, in the owner's timezone:

- **Merged**, with what it means for a user.
- **In progress**, the real branch.
- **Next.**
- **Waiting on you**, each item with a recommendation.

Interrupt at once for a halt, a timeout or anything that touches production.
When the backlog empties, stop the cadence with a final list of owner items.

## 8. Retrospect and refine

After a halt, a timeout, a misbuilt ticket or an owner correction, and
periodically: run the refinement loop in `05-refining-the-process.md`.

## Tools the supervisor calls

Every fact and decision above comes from a command, so a session does not
improvise them:

- `orient --json`: halt, attach, start or nothing to do, with anomalies.
- `status --json`, `backlog --json`: counters, current ticket, next pick.
- `events`, `await-event`: the terminal-event file, read as data.
- `facts --json [--issue N] [--pr N]`: the loop checkout's branch, whether it
  is clean, the base head on `origin`, and an issue's closing PR (or a PR on its
  own): whether it merged and its CI conclusion, `success`, `failure`,
  `pending` or `none` when the repo has no CI, read without touching the
  working tree.
- `report`: the report sections from the same facts, including the tickets the
  worker declined.
- `approval <action>`: who may do an action, from the table below.

## Read-only on the loop's checkout

While an engine is alive the supervisor never checks out, switches, resets,
stashes, pulls, merges or commits in the loop's working tree; the worker owns
it, and a changed HEAD can move the worker off its branch. Verification reads
`facts --json`. A test fails if `commands/work.md` contains a state-changing git
command.

## Approval reference

The table is encoded in the engine and tested; `approval <action>` answers from
it, and an action it does not list needs the owner.

| Action | Supervisor alone | Owner's word |
|---|---|---|
| File, label, order tickets | yes | |
| Add tickets to the backlog by PR, merge it when checks pass | yes | |
| Start the engine, attach a watcher | yes | |
| Record a note or a process rule by PR | yes | |
| Stop an engine that is about to build on a wrong base | yes, report at once | |
| Open a PR for a worker's pushed, gated branch | yes, report it | |
| Clear a HALT, reset counters | | yes |
| Close issues, delete branches with unmerged work | | yes |
| Touch production data or secrets | | yes |
| Publish anything outside the repository | | yes |
| Change a principle, this table or a blocking check | | yes |
| Raise the run budget | | never |
