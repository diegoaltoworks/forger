# Development process - <project name>

One ticket per iteration, quality gates green, small clean commits.
**backlog.json is the source of truth for loop status.** The tracker is the
human-facing mirror and the intake channel.

This file is the per-repo brain of the work loop. The plugin's engine and
commands are generic; everything specific to THIS project lives here and in
`.claude/workloop.config.json`. Fill in every section below.

## What this repo is

<One paragraph: what the project is, where it sits in the stack, who consumes it.>

## The gates

The exact command is in `.claude/workloop.config.json` (`gates`). Never proceed
on red. Describe here anything a gate does not catch that a reviewer should.

## The tracker

`workloop.config.json` `tracker.kind` says where live tickets are published:

- `github` (default): every backlog ticket is mirrored as a GitHub issue. Planners
  create the issue and record its number on the ticket as `issue`. The worker
  claims it by assigning itself and closes it through the PR (`Closes #<n>`).
  Open issues carrying the intake label (`tracker.label`, default
  `ready-for-agent`) that are not yet in `backlog.json` are adopted by the
  planners and by the worker's inbox step. Issues labelled `wayfinder:*` are
  decision tickets, never work; the loop must ignore them.
- `local`: `backlog.json` is the only record.
- `none`: never touch an issue tracker.

If `docs/agents/issue-tracker.md` exists (written by `/setup-matt-pocock-skills`),
it is the authority on how this repo talks to its tracker; follow it.

## Rules

1. One ticket per iteration.
2. Gates green before every commit and merge.
3. Read the code a ticket touches, and any reference it names, before writing.
4. One `feat:` PR per ticket (code + tests + docs). Push the branch the moment
   gates are green, before the PR. Squash-merge.
5. Keep the public API working - additive where possible.
6. Blocked? Signal `<process>stop</process>` with a reason.

## Project gotchas

List the hard constraints a worker MUST respect - the things that surprised a
careful reader, the data-safety rules, the forbidden calls, the invariants. The
worker treats these as enforced, not advisory. For example:

- <e.g. "Never delete data; removal means active = 0.">
- <e.g. "Never let user input reach the raw-SQL filter path.">
- <e.g. "Phase 1 is read-only; no writes outside a write-scoped ticket.">

## The ticket shape

Each entry in `backlog.json` `features` looks like:

```json
"<ticket_id>": {
  "priority": "P0",
  "status": "not_started",
  "type": "feature",
  "depends_on": [],
  "effort": "medium",
  "issue": 42,
  "description": "What and why, enough to implement without guessing.",
  "acceptance_criteria": ["testable outcome", "another testable outcome"],
  "files": ["src/area/"],
  "reuse": ["the reference implementation or pattern to follow"]
}
```

A good ticket is a **vertical slice**: a narrow but complete path through every
layer it touches, demoable or verifiable on its own, sized to one fresh context
window. A wide mechanical refactor (rename a shared symbol, retype a column) is
the exception: sequence it expand, migrate in batches, contract, each batch its
own ticket with `depends_on` on the expand.

`files` and `reuse` are **hints for a worker starting cold**, not a contract;
they go stale, so the worker reads the code before trusting them. `issue` is the
tracker number when `tracker.kind` is `github`. Set `repo` only if the ticket
belongs to a different codebase (the loop tracks but does not implement it).
