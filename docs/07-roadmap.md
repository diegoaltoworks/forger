# Roadmap

In order. Each step is useful on its own, and each makes the next one smaller.

## 1. Engine fixes

From the failure catalogue, with a test for each outcome:

- Count `completed` only when the PR is merged; read status from the base
  branch.
- Pass the deadline to the worker and warn before it.
- Add the branch, last commits and PR state to a timed-out run's iteration log.
- `status --json`, the engine's own process id in a file, and a terminal-event
  file for watchers.
- Adopt labelled issues from the tracker, with `depends_on`.
- Refuse to start an engine whose tracker access is not a scoped token, so a
  loop never acts as the machine's global account.
- Start the engine detached from the session that launched it, and write its
  own process id for `status`.
- Run the cheap checks (commit message, docs) before the long gates, so a
  rejection comes in seconds.

Already in place, with a test each: killing the worker's whole process group on
timeout, deciding an outcome from facts, telling infrastructure errors from
worker failures, clearing a HALT together with its counters, ignoring local-only
paths when checking the tree, one engine at a time with orphan close-out, and
progress measured by merges.

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
- **Facts before belief:** it reads `status --json`, the terminal-event file and
  the PR checks, never a completion notice or its own pattern match, and it
  compares the work order with `backlog --json` before accepting "all done"
  (backlog ticket `work_supervisor`).
- **Approval policy enforced:** never clears a HALT or resets counters without
  the configured approval.
- **Impact analysis:** before a worker pushes, it lists what a change touches
  and runs only the affected tests (`retro_and_measures` measures the CI rounds
  per ticket that show when this is missing).
- **Evals:** setup, intake of a bug, a feature and a spike, ordering, an anomaly
  (a dead engine, a misleading ticket label, a ticket completed but unmerged), a
  report, a retro.

## 3. State that does not live on one laptop

The work order, engine state, playbook and logs move to a state branch or to the
tracker. Needed for every hosting option, and it already makes the local loop
survive restarts.

## 4. A sample product, then off the laptop

- **First: a sample product repository** that the evals and the CI-native mode
  run against, with forger installed from outside and a fixed set of owner
  requests replayed to compare forger versions; see
  [ADR 0012](adr/0012-a-sample-product-repository-proves-forger-off-itself.md).
- **Then: CI-native**, targeting the sample repository first. A scheduled supervisor job runs one `manage` tick; a
  dispatched worker job builds one ticket, with a concurrency group for one
  worker at a time. Reports go where the owner reads them on a phone; a HALT
  waits for an owner action (a comment or a label).
- **If cold starts are too slow:** a persistent machine per repository running the
  engine as today. Measure first.
- **Later:** a hosted app over the same playbook, state and commands: sign in,
  pick a repository, the first-run interview in the browser, a dashboard with the
  report and the owner's open questions, approvals as buttons, per-repository
  spend limits, isolated sandboxes.

## 5. Generalise

- Strip what is specific to one project or one account from the commands and
  templates; everything project-specific lives in the consumer repository.
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
