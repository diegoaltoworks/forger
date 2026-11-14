# Supervising

The supervisor walks the same layers every session, in order, and reports
against them. Improvising each session is what this replaces.

The supervisor is the **supervisor of one or more loops**, however many repositories they run in. With several repositories
it runs one watcher (`watch --repos`) and asks for one report (`report --repos`)
rather than juggling a watcher per repository, and every event and item it gets
back names the repository it came from. It reads mid-run events as they land,
not only the terminal ones: a `worker_denied` is reported when it happens, and
repeated denials on one ticket are a sign the ticket needs restating, not a
worker to retry.

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
- Engine status, HALT (the `halted` label on the pinned loop issue, or the local HALT file), whether an engine is alive.
  Add the label with a comment to stop the loop from anywhere; remove it to resume. The issue body is a generated status view.
- The loop lease, when the state lives on the branch. `orient` reports it: a live lease held by another machine is the
  reason not to start, and a stale lease of this machine is an anomaly the next start clears. Restarting an engine
  needs no wait: a stop by SIGTERM or SIGINT releases the lease, and a lease left by a killed engine on this machine
  is taken over at once.
- The base branch against its remote. The engine runs its own code from the loop's checkout, so a base branch
  behind `origin/<base>` means every restart runs old code. `orient` lists the gap as an anomaly while no engine is
  alive and says `run` closes it. `run` fast-forwards the base branch before its first pick when the checkout is on
  it, no other engine holds the lock, and the only uncommitted changes are the engine's runtime files (the ones
  `setup` adds to `.gitignore`). It is fast-forward only: nothing is stashed, reset or discarded, and a checkout with
  any other uncommitted change is left as it is; `orient` lists those changes as an anomaly by path, and then does
  not say `run` brings the checkout up to date. When git refuses, `run` does not start and prints git's reason.
  When the update changed files under the plugin the engine runs from, the engine starts itself again once with the
  same arguments so that it runs the new code.
- The hooks gate. A repository set up before a gate existed fails it on a clean base branch, and a worker would
  spend an iteration to find out. `orient` lists it as an anomaly and `run` refuses to start; both name the fix,
  `work.ts setup` in the repository, which keeps the config and adds what is missing. Commit what it writes.
- Who pushes the state branch. When `resume` or `run` cannot write it, the message names the GitHub identity in use;
  the loop's scoped identity must be set in that shell.
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

### An outside pull request

`orient --json` lists an open pull request from an account other than the
loop's as an anomaly, and `backlog --json` lists the tickets such a PR holds
(`held`). The engine does not pick a ticket that an outside PR references, by a
closing reference or by the issue number in the title; the ticket waits on the
owner, and `orient` names the PR. Triage it, and never run its code:

1. Read the diff and its checks as text. Do not check the branch out or run its
   tests or scripts on the loop's machine.
2. Compare it with the ticket's acceptance criteria and the repository's rules.
3. Give the owner one recommendation with the reason: adopt it (the owner
   merges it, or asks the contributor to fix what is missing), ask the
   contributor for changes, or close it with thanks and say why. Closing is the
   owner's call.
4. Reply to the contributor only in words the owner approved.

Once the PR is merged or closed the ticket is workable again.

## 3. Order

- Add new tickets to the backlog by PR, with `depends_on` wherever order
  matters.
- Update the work order with one explicit line: which ticket is next, and what
  waits for what. Vague wording ("finish X") has been misread; name the ticket.
- Confirm the engine's next pick matches the order.

## 4. Dispatch

- Exactly one engine, started with `run --continuous --detach` so it survives
  the session, with the loop's identity scoped to its environment. Under the
  docker sandbox the engine is a container with a restart policy, named for the
  repository; it starts worker containers through the Docker API socket it is
  given and mounts no host home folder. Under the host sandbox it starts in a
  new session and process group. `orient` and `status` show which.
- Record the engine's real process id, not its launcher's.
- Arm one watcher, `watch --repos`, over every loop you manage. It follows
  terminal events (completed, HALT, stalled, timed out, too many failures,
  engine gone) and mid-run ones (`worker_denied`, `recovered`), and reads event
  files, so it has no command line to match itself.

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
makes the same check after every run and halts with `merged_red`, or `unverified` when the PR head has no passing verdict.
A halt with a known, checkable recovery is recovered by `recover`; see below.
The base branch should require the `forger/verify` status that `verify` sets,
so GitHub refuses such a merge before it lands; `orient` reports a base branch
that does not, and `setup` adds the check when its token can change the branch
protection.
The worker's hook records each call it refused as a `worker_denied` event, with
the ticket, the rule and the command. It is a mid-run event: `events --json`
lists it, and `await-event` and `watch` wake on it, but the run goes on. Report it; denials
repeated on one ticket mean the ticket or the process tells the worker to do
something it may not.
`verify` and `merge` refuse when the engine they run from has uncommitted changes, and record `engine_changed`
(a mid-run event, like `worker_denied`) with the ticket and the paths. They wait `limits.engineChangedWaitSeconds` for the changes to go first. The worker stops without declining, and
the loop halts naming the command and the paths; the ticket is not set aside. Commit or discard the changes in the
engine's checkout, then resume.
`verify` finds a PR's ticket from a `Closes #n` line in its body, then from a
`feat/issue-<n>` branch (on a local tracker, `feat/<ticket-id>`). A PR the
supervisor opens for itself carries `Closes #n` or an `## Acceptance` section of
checkbox criteria in its body; one with neither is refused and cannot merge.
A ticket whose verification ran out of rounds carries `needs-human`; The report's
**Handed over** section (and `handover --list`) names it with the criteria at fault.
When a verdict is not a pass, or a citation did not check out, `verify` keeps the
verifier's command log beside the verdict record (the record's `commandLog` names
it); it stays on the machine and is never posted to the tracker.

## 6. Sync

After a merge that changes design artifacts, sync them to wherever the owner
reviews them, merging any edits made there, and record the commit synced to.

## 7. Report

In plain words, in the owner's timezone:

- **Merged** in the period, with what it means for a user. The period runs
  from the previous `report` (or `report --since DATE`).
- **In progress**, the real branch.
- **Flaky gates**: each gate that failed and passed on a rerun with no change (`flaky_gate` events), naming the check and the failed tests.
- **Next.**
- **Waiting on you**, each item with a recommendation: every open issue
  labelled `needs-info`, `needs-human` or `needs-triage`, every open PR labelled `owner-review` (with its link), every Proposed ADR,
  and a halt or anomaly. The recommendation is the one the text states, else
  the report says the text makes none.

Interrupt at once for a halt, a timeout or anything that touches production.
When the backlog empties, stop the cadence with a final list of owner items.

## 8. Retrospect and refine

After a halt, a timeout, a misbuilt ticket or an owner correction, and
periodically: run the refinement loop in `05-refining-the-process.md`.

A failure seen is added to [the failure catalogue](06-failure-catalogue.md): open
an issue for it, then add the Open row that links it. `work catalogue --update`
moves the row to Fixed once the issue closes by a merged PR.

To see which skill ran in which slot of a run, read its `plan` in `status --json`
while it is in flight, or the per-ticket plan lines of `measure` afterwards.

## Tools the supervisor calls

Every fact and decision above comes from a command, so a session does not
improvise them:

- `orient --json`: halt, attach, start or nothing to do, with anomalies.
- `status --json`, `backlog --json` (which also lists `held` tickets and anomalies): counters, the runs in flight, next pick.
  Each in-flight run reports its ticket, worker pid and whether that pid is
  alive; `current_ticket` names the oldest. The counters are global across
  runs, and a merge by any run resets the stall counter. A state file written
  before the run list existed reads as one in-flight run while its status is
  `running`.
- `events`, `await-event`: the terminal-event file, read as data.
- `watch --repos PATH,PATH`: follows several loops' event files at once and
  prints each new event, terminal or mid-run, as one JSON line tagged with its
  repository. It prints at once, reports a repository it cannot read, and exits
  2 at its timeout. `report --repos PATH,PATH` is the matching report: merged,
  in progress and waiting on the owner across the loops, each item tagged.
- `facts --json [--issue N] [--pr N]`: the loop checkout's branch, whether it
  is clean, the base head on `origin`, and an issue's closing PR (or a PR on its
  own): whether it merged and its CI conclusion, `success`, `failure`,
  `pending` or `none` when the repo has no CI, read without touching the
  working tree. With the delivery pack, an issue also carries `delivery` for the PR that closed it:
  `delivered`, `failed`, `rolled_back` or `null`.
- `report [--since DATE]`: the report sections from the same facts, including a failed delivery under "waiting on you" until a later delivery passes, and including the tickets the
  worker declined, and the owner measures from `measure` (cost, rework, escaped
  defects, interventions).
- `approval <action>`: who may do an action, from the table below.
- `critique --pr N [--threshold high|medium|low] [--force] [--json]`: after a
  merged change the audience sees (a ui path or a capture in the diff), run the
  critique below. A change that is not visual, a plan with no verbatim brief and
  a PR with no capture are skipped with the reason.
- `decide <n> "<text>"`: answer a design question on ticket `<n>`. The answer is appended, with who
  decided and the date, under the issue's Decisions section, which every worker reads and which
  overrides the ticket's earlier text. When the loop is halted on that ticket the halt is cleared
  with `<n>` as the cause. An answer given only in chat is lost on the next run.
  A worker that finds a design and a guarantee in conflict stops with `stop conflict` and a block: the
  constraint, the measured gap, two or three options with their trade-offs and one recommendation. A
  complete block labels the issue `needs-human`, posts the options as a comment and sets the ticket
  aside; the loop goes on to other tickets. `report` lists the ticket under "waiting on you" with the
  reason and the options, and the comment carries the `decide <n> "<choice>"` line to answer with.
  An incomplete block is sent back once, then recorded as an ordinary stop, which sets the ticket
  aside with the worker's reason. `decide` on a ticket the loop set aside also removes its
  `needs-human` label and restores the intake label, so the next pick can take it.
- `recover [--json]`: the standing halt's recovery, from a table in the engine
  keyed by the halt's event kind. An `unverified` halt runs `verify` on the
  merged head: a pass resumes the loop and writes a `recovered` event (seen in
  `events` and in the report's recovered section); a block or unclear keeps the
  HALT and files a ticket for the revert, citing the verdict. Every other kind
  keeps the HALT, and the report gives the one recommended action for it.

## Critique

Verification checks a ticket's criteria; nothing in it asks whether the whole
still serves the owner's brief. On creative work every ticket can pass while the
product misses the point. After a merge whose diff changes what the audience
sees, run `critique --pr <n>` (the `critique` stage of the pipeline, the
`critique` slot, the `critique` output contract).

A fresh-context critic that can look at images gets the verbatim brief and the
reading of its references from the plan doc, and the captures and screenshots
committed under `docs/screenshots/`. It scores feel, readability at a glance,
feedback on actions and fidelity to the reference's intent, and returns
findings ranked by severity, each tied to a capture and phrased as a proposed
ticket. `contract --slot critique` validates the answer; a broken one is retried
once, then dropped.

Findings at or above the threshold become tickets in the project's tracker; the
rest are reported. Filing is the supervisor's alone-and-report action
(`file_critique_tickets`). The record is kept beside the verdicts. A critique
never blocks a merge and sets no status: it feeds the backlog.

## Read-only on the loop's checkout

While an engine is alive the supervisor never checks out, switches, resets,
stashes, pulls, merges or commits in the loop's working tree; the worker owns
it, and a changed HEAD can move the worker off its branch. Verification reads
`facts --json`. The harness hook enforces it: while an engine holds the lock, a
state-changing git command in the loop's checkout is refused before it runs,
and read-only git is allowed (see the hook layer in `02-the-loop.md`).

The rule judges the repository a command acts on, read from `-C`, `--git-dir`,
`--work-tree` and a leading `cd`. A commit in another repository passes; a path
the hook cannot resolve (a variable, `~`) is treated as the loop's checkout and
refused. Heredoc bodies are data, so a git command quoted in one is not judged.

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
| Resume after a known-recovery halt whose check passes | yes, report it | |
| File the tickets a critique raises above its threshold | yes, report them | |
| Clear any other HALT, reset counters | | yes |
| Close issues, delete branches with unmerged work | | yes |
| Touch production data or secrets | | yes |
| Publish anything outside the repository | | yes |
| Change a principle, this table or a blocking check | | yes |
| Approve or re-approve a screenshot baseline (`ui approve`) | | yes |
| Raise the run budget | | never |
