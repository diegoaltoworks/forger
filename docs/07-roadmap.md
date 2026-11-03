# Roadmap

In order. Each step is useful on its own, and each makes the next one smaller.

## 1. Engine fixes

From the failure catalogue, with a test for each outcome:

- Kill the worker's whole process group on timeout, escalate to SIGKILL after a
  grace period, resolve on `exit`. (The 37-hour hang.)
- Count `completed` only when the PR is merged; read status from the base
  branch.
- Decide a timed-out run's outcome from facts: merged, pushed, or nothing.
- Measure progress by merges, not by the remaining count.
- Pass the deadline to the worker and warn before it.
- Always write the iteration log, with what is known on a timeout.
- Log the ticket the worker actually took.
- `status --json`, the runner's own process id in a file, and a terminal-event
  file for watchers.
- Adopt labelled issues from the tracker, with `depends_on`.

## 2. A `manage` skill for the supervisor

Turns `docs/04-supervising.md` and `docs/05-refining-the-process.md` into a
skill, so every session walks the same layers instead of improvising.

- **First run:** an interview with recommended answers; writes
  `.claude/manage/config.json` (reporting, intake, approval, budget, sources,
  identity) and `.claude/manage/playbook.md`.
- **Commands:** `manage` (orient and report), `manage intake "<request>"`,
  `manage report`, `manage retro`, `manage refine`.
- **The refinement loop is first class:** `retro` builds the timeline from a
  transcript and CI's logs and proposes rules; `refine` lands approved changes
  in the playbook, the process doc or a ticket for a check, by PR.
- **Approval policy enforced:** never clears a HALT or resets counters without
  the configured approval.
- **Evals:** setup, intake of a bug, a feature and a spike, ordering, an anomaly
  (a dead runner, a misleading ticket label, a ticket completed but unmerged), a
  report, a retro.

## 3. State that does not live on one laptop

The work order, engine state, playbook and logs move to a state branch or to the
tracker. Needed for every hosting option, and it already makes the local loop
survive restarts.

## 4. Off the laptop

- **First: CI-native.** A scheduled supervisor job runs one `manage` tick; a
  dispatched worker job builds one ticket, with a concurrency group for one
  worker at a time. Reports go where the owner reads them on a phone; a HALT
  waits for an owner action (a comment or a label).
- **If cold starts are too slow:** a persistent machine per repository running the
  runner as today. Measure first.
- **Later:** a hosted app over the same playbook, state and commands: sign in,
  pick a repository, the first-run interview in the browser, a dashboard with the
  report and the owner's open questions, approvals as buttons, per-repository
  spend limits, isolated sandboxes.

## 5. Generalise

- Strip what is specific to one project or one account from the commands and
  templates; everything project-specific lives in the consumer repository.
- A sample repository the evals and the CI-native mode run against.
- The ticket sections as a configurable set, with the defaults from
  `docs/03-tickets.md`.

## Settled

- **Licence and openness:** MIT, open source.
- **Where it lives:** this repository is the single source of the plugin and its marketplace.
- **The name:** forger.
- **The tracker:** GitHub Issues are the backlog; see [ADR 0001](adr/0001-github-issues-are-the-backlog.md).
- **Determinism first:** see [ADR 0002](adr/0002-determinism-first.md).
- **Dependencies:** none on third-party skill collections. Forger carries its
  own interview, test-first, review and diagnosis steps, with their decisions in
  tools.
