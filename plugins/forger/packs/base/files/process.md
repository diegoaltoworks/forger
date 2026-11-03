# Development process - <project name>

One ticket per iteration, quality gates green, small clean commits.
**On GitHub, the issues are the backlog**: an open issue with the intake label is
a ticket, and an issue closed by a merged PR is completed. Elsewhere,
`backlog.json` is the backlog.

This file is the per-repo brain of the work loop. The plugin's engine and
commands are generic; everything specific to THIS project lives here and in
`.forger/workloop.config.json`. Fill in every section below.

## What this repo is

<One paragraph: what the project is, where it sits in the stack, who consumes it.>

## The gates

The exact command is in `.forger/workloop.config.json` (`gates`). Never proceed
on red. Describe here anything a gate does not catch that a reviewer should.

## The tracker

`workloop.config.json` `tracker.kind` says where live tickets are published:

- `github` (default): open issues carrying the intake label (`tracker.label`,
  default `ready-for-agent`) are the tickets. Priority and effort are labels
  (`P0`-`P3`, `effort:small|medium|large`), `depends_on` is the native
  blocked-by, and `needs-human` / `deferred` labels carry those statuses. The
  worker claims an issue by assigning itself and closes it through the PR
  (`Closes #<n>`); that merge is what completed means. Labels in
  `tracker.ignore` (such as `wayfinder:*` decision tickets) are never work.
- `local`: `backlog.json` is the only record.
- `none`: `backlog.json`, and never touch an issue tracker.

## Rules

1. One ticket per iteration.
2. Gates green before every commit and merge.
3. Read the code a ticket touches, and any reference it names, before writing.
4. One `feat:` PR per ticket (code + tests + docs). Push the branch the moment
   gates are green, before the PR. Squash-merge.
5. Keep the public API working - additive where possible.
6. Blocked? Signal `<process>stop</process>` with a reason.

## Project gotchas

The first two are forger's defaults; keep them. Then list the hard constraints
a worker MUST respect - the things that surprised a careful reader, the
data-safety rules, the forbidden calls, the invariants. The worker treats these
as enforced, not advisory.

- **Determinism first** (principle 0). Every decision a ticket adds or changes
  lands as a tested command with machine-readable output, not as prompt text.
  Pure logic is split from I/O, and side effects sit behind an injectable `CommandRunner`.
- **Comments say why, never narrate a change.** History belongs in the commit.
- <e.g. "Never delete data; removal means active = 0.">
- <e.g. "Phase 1 is read-only; no writes outside a write-scoped ticket.">

The retro refines this file over time: a lesson that holds for this project
lands here by PR, and one that holds for every project goes upstream to forger.

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
