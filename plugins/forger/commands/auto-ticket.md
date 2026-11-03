---
description: Implement exactly one backlog ticket end to end (invoked by the work-loop engine)
allowed-tools: Bash(*), Read, Write, Edit, Glob, Grep, Task, TodoWrite, WebSearch, WebFetch
---

# Work a single ticket - start to finish

This is the per-iteration worker. The work-loop engine invokes it once per
ticket; a human normally does not type it. It implements ONE ticket completely -
code, tests, docs, gates, review, PR, merge - and signals the engine when done.

Everything project-specific (the quality-gate command, the repo's hazards, the
tracker settings, the doc set) lives in this repo's `.claude/process.md`
and `.claude/workloop.config.json`. Read them; do not assume another repo's rules.

## Current state
- **Git status:** !`git status --short`
- **Branch:** !`git branch --show-current`
- **Recent commits:** !`git log --oneline -5`

The tracker settings are in `.claude/workloop.config.json`; its conventions are in `.claude/process.md`.

## Skill slots

Some steps below are skill slots: the project may plug an installed skill into
each. Resolve them once, up front:

```
bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" skills --json
```

For a slot, when `use` is `skill`, invoke the skill named in `skill` and let it
do that step. When `use` is `builtin`, do the step yourself as written here, as
you also do when the tool fails. Never name or choose a skill yourself.

Slots used here: `test_first` (step 4), `diagnose` (step 5), `review` (step 6)
and `merge_conflicts` (step 8).

## Read first (in order)
1. `.claude/process.md` - the workflow rules and the **project gotchas** (REQUIRED)
2. `.claude/workloop.config.json` - gates, base branch, model tiers, tracker
3. This repo's docs (whatever `process.md` points at: architecture, domain,
   decisions; `GLOSSARY.md` and ADRs if present - use their vocabulary)
4. `.claude/inbox/*.md` - human instructions
5. The backlog: with `tracker.kind` `github` the open issues carrying
   `tracker.label` are the tickets; otherwise `.claude/backlog.json`

## Your task: one full iteration

### 1. Work order
Human instructions first: acknowledge new `.claude/inbox/*.md` items (prefix
with a clock) and add them to the backlog - as an issue with the intake label on GitHub,
otherwise in `backlog.json` with a priority. Then continue.

### 2. Select ONE ticket
Take the engine's pick, `next` in the output of
`bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts backlog --json`. Do not re-derive the
order: it is the highest-priority `not_started` ticket whose every `depends_on`
is `completed` and whose `repo` is absent or this repo's. On GitHub, ticket
`issue-<n>` is issue #<n>: read it with `gh issue view <n>`; never take an
issue whose labels match `tracker.ignore`.

One ticket per iteration - no more. If the ticket names a blocker only a human
can supply, signal `stop`.

### 3. Start it
- Branch from the configured base branch: `git checkout -b feat/<ticket-id>`
  (on GitHub, `feat/issue-<n>`)
- If the ticket has an `issue`, **claim it** before any work:
  `gh issue edit <issue> --add-assignee @me`. An assigned issue is a claimed one;
  concurrent sessions skip it.

### 4. Implement
- Follow existing patterns - read the files the ticket names and match the code
  around them. `files` and `reuse` are hints, not a contract; the code is.
- **Respect every gotcha in `process.md`.** Those are the repo's hard
  constraints (data-safety rules, forbidden calls, invariants). Treat them as
  enforced, not advisory.
- Separate files per concern where the codebase is organised that way - a new
  responsibility gets a new file, not a section bolted onto an existing one.
- Work test-first from the ticket's acceptance criteria, at the highest existing
  seam, in the `test_first` slot. Built-in: write the failing test, make it pass,
  then refactor.
- Pure logic must be pure and tested as such.

### 5. Quality gates (must all pass)
Run the gate command from `workloop.config.json` (`gates`). Fix failures; do not
proceed on red. If a gate is red for a reason you cannot see, make one honest
diagnosis attempt in the `diagnose` slot. Built-in: reproduce it, read the
failing output, form one hypothesis and test it. If it is still red, signal `stop`.

### 6. Review pass
A second pass is part of Done, not a nicety.

Review the diff against the base in the `review` slot, with the ticket as the
spec. Built-in: review your own diff (`git diff <base>...HEAD`) on two axes: **standards** - does
it follow this repo's documented standards and the patterns around it; and
**spec** - does it do exactly what the ticket asked (the ticket's issue, or its
body in `backlog.json`), nothing missing, nothing extra. If `process.md` names a
review agent, run that as well.

Address anything at medium severity or above, or say explicitly why you are not.
Also grep your diff for any of the hazard patterns `process.md` forbids.

### 7. Docs + ticket updates (in the SAME commit)
Documentation is part of Definition of Done, every iteration:
- Update any doc your change caused to drift. Keep docs durable and qualitative -
  no counts, dates, or transient specifics.
- Update any `README.md` your change makes stale.
- Confirm tests assert what matters, not merely that they pass.
- With `local` or `none`, set the ticket `status: "completed"` in
  `backlog.json`. On GitHub do not: the merge closing the issue is the status.
- Update `.claude/inbox/*.md` (clock -> check) for anything you finished.

### 8. Commit + PR
One `feat:` commit with everything (code + tests + docs, and backlog.json when
it is the backlog).

**Commit and push the moment the gates are green - before the PR, before
anything else.** Iterations get cut off by the budget cap *after* finishing the
work but *before* the branch leaves the machine, stranding a completed ticket
locally while the backlog claims it is done. Pushing first costs seconds and
makes the worst case an unmerged branch on the remote rather than lost work.

```
git push -u origin feat/<ticket-id>     # FIRST - do not defer this
gh pr create --title "feat: <summary>" --body "<what + how + gate results>

Closes #<issue>" --base <base-branch>
gh pr checks <pr> --watch               # block until every check finishes
bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" facts --json --pr <pr>
gh pr merge --squash --delete-branch    # only when facts says checks_ok
```
**Never merge red.** The merge decision is `pr.checks_ok` in `facts --json`, not
your reading of the watch output:
- `success` - every check passed: merge.
- `none` - the repo has no CI workflow; say so in the PR and rely on the local
  gates.
- `pending` - checks are not registered or not finished yet: watch again. If it
  is still `pending` after a second watch, signal `stop`.
- `failure` - read the failed job's log (`gh run view <run> --log-failed`), fix
  the cause, re-run the gates locally, push, and watch again.

`Closes #<issue>` (when the ticket has one) is what closes the tracker issue:
the merge does it, no extra call. Clean commit messages only - no AI
attribution, no Co-Authored-By. If `gh` is unavailable, squash-merge locally to
the base branch, push, and close the issue with `gh issue close` if you can.
If the merge conflicts, resolve it in the `merge_conflicts` slot (built-in: by
hand) and re-run the gates; never `--abort` and walk away from a green ticket.

### 9. Completion signal
End your response with exactly one:

- `<process>complete</process>` - ticket done, gates green, merged.
- `<process>stop</process>` then a reason - blocked / needs human input / no
  actionable ticket.

## Rules
- ONE ticket per iteration. Quality gates must pass. Small, clean commits.
- Check the work order first - human instructions win.
- Claim the issue before working it; close it through the PR.
- Never adopt or work an issue whose labels match `tracker.ignore`.
- If blocked, signal `stop` with a clear reason rather than guessing.
- Obey the data-safety and write-scope rules in `process.md` without exception.
