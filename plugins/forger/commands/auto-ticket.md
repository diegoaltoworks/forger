---
description: Implement exactly one backlog ticket end to end (invoked by the work-loop engine)
allowed-tools: Bash(*), Read, Write, Edit, Glob, Grep, Task, TodoWrite, WebSearch, WebFetch
---

# Work a single ticket - start to finish

This is the per-iteration worker. The work-loop engine invokes it once per
ticket; a human normally does not type it. It implements ONE ticket completely -
code, tests, docs, gates, review, PR, merge - and signals the engine when done.

Everything project-specific (the quality-gate command, the repo's hazards, the
tracker settings, the doc set) lives in this repo's `.forger/process.md`
(`.claude/process.md` in a repo not yet migrated; the prompt names the path)
and `.forger/workloop.config.json`. Read them; do not assume another repo's rules.

## Current state
- **Git status:** !`git status --short`
- **Branch:** !`git branch --show-current`
- **Recent commits:** !`git log --oneline -5`

The tracker settings are in `.forger/workloop.config.json`; its conventions are in `.forger/process.md`.

## Skill slots

Some steps below are skill slots: the project may plug an installed skill into
each. Resolve them once, up front:

```
bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" skills --json
```

For a slot, read `invoke`. `skill`: invoke the skill named in `skill`. `file`:
read the file at `path` and follow it. `builtin`: do the step yourself as written
here, as you also do when the tool fails. Start every `skill` or `file` slot
with the report's `preamble`, verbatim, and never invoke a skill listed in
`forbid`. Never name or choose a skill yourself.

Slots used here: `test_first` (step 4), `diagnose` (step 5), `review` (step 6),
`risk` (step 6), `pr_body` and `merge_conflicts` (step 8).

## Read first (in order)
1. `.forger/process.md` - the workflow rules and the **project gotchas** (REQUIRED)
2. `.forger/workloop.config.json` - gates, base branch, model roles, tracker
3. This repo's docs (whatever `process.md` points at: architecture, domain,
   decisions; `GLOSSARY.md` and ADRs if present - use their vocabulary)
4. `.forger/inbox/*.md` - human instructions
5. The backlog: with `tracker.kind` `github` the open issues carrying
   `tracker.label` are the tickets; otherwise `.forger/backlog.json`

## Your task: one full iteration

### 1. Work order
Human instructions first: acknowledge new `.forger/inbox/*.md` items (prefix
with a clock) and add them to the backlog - as an issue with the intake label on GitHub,
otherwise in `backlog.json` with a priority. Then continue.

### 2. Read the ticket named in the prompt
The prompt names the ticket to build: the engine's pick. Do not choose another
and do not re-derive the order. On GitHub, ticket `issue-<n>` is issue #<n>:
read it with `gh issue view <n>`; otherwise read it in `backlog.json`. When the
prompt says there is no workable ticket, signal `stop`.

Build it or decline it. If the ticket is blocked on something only a human can
supply, is too large for one iteration, or is unclear, run
`bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" decline --ticket <id> --reason blocked|too-large|unclear --detail "<what the owner must change>" --json`,
then signal `stop` and say which and why. The command records the decline and
takes the ticket out of the backlog; do not relabel the issue by hand.

### 3. Start it
- Branch from the configured base branch: `git checkout -b feat/<ticket-id>`
  (on GitHub, `feat/issue-<n>`)
- If the ticket has an `issue`, **claim it** before any work:
  `gh issue edit <issue> --add-assignee @me`. An assigned issue is a claimed one;
  concurrent sessions skip it.

### 4. Implement
- If the issue has a `Satisfies:` line, read the context of each ID it names with
  `bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" slice <ID...>` (exit 2: no spec provider installed; carry on).
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

Read the gate's exit status, not its last lines: a gate piped into `tail` or
chained with `;` reports success whatever happened. A failing gate stops the
push. Any edit after a gate run - a test, an import, a doc - makes that run
stale: the gates run once more on the final tree, after the last edit and
before the commit.

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

Then the `risk` slot. Built-in: list what the change touches beyond the diff
(callers, consumers, docs, config) and run the tests for it. Its findings are
input to you, to fix or to explain; the verifier, not this slot, decides the
merge.

### 7. Docs + ticket updates (in the SAME commit)
Documentation is part of Definition of Done, every iteration:
- Update any doc your change caused to drift. Keep docs durable and qualitative -
  no counts, dates, or transient specifics.
- Update any `README.md` your change makes stale.
- Confirm tests assert what matters, not merely that they pass.
- With `local` or `none`, set the ticket `status: "completed"` in
  `backlog.json`. On GitHub do not: the merge closing the issue is the status.
- Update `.forger/inbox/*.md` (clock -> check) for anything you finished.

### 8. Commit + PR
The PR body comes from the `pr_body` slot. Built-in: write it by
`docs/03-tickets.md`. Whatever the slot wrote, save it to a file and run
`bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" pr-body --file <file> --issue <n> --section "<title>" --fix --json`
(one `--section` per review section the ticket names); open the PR only when it
reports `ok`.

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
bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" verify --pr <pr> --json
bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" merge --pr <pr> --json
git checkout <base-branch> && git pull
```
**Never merge red, and never merge by hand.** `merge` waits for every check to
finish, squash-merges only when all passed and `verify` recorded a passing
verdict for the PR's current head (a later push makes it stale; `block` and
`unclear` both refuse and name the criteria), and confirms the merge from the
PR's state; it exits 1 when it refuses. When `verify` does not pass, run
`handover --pr <pr> --json`: `move: "fix"` means make the open criteria decidable
(a test, a command, a clearer assertion), push, and `verify` again;
`move: "hand_over"` means the rounds are spent, the issue is now `needs-human`
with the criteria commented, and you signal `stop`. Act on its JSON, not on your reading of
CI:
- `merged: true` - done. `checks: "none"` means the repo has no CI workflow; say
  so in the PR, the local gates were the only assertion.
- `checks: "failure"` - `failing_checks` names them. Read the failed job's log
  (`gh run view <run> --log-failed`), fix the cause, re-run the gates locally,
  push, and run `merge` again.
- `checks: "pending"` - CI did not finish within the timeout: run `merge` once
  more; if it refuses again, signal `stop`.

The engine reads the merged PR's checks after the run. A ticket merged on
failing or pending checks is recorded as `merged-red` and halts the loop: it
never counts as completed. A ticket merged with no passing verdict for its
head is recorded as `unverified` and halts the same way.

`Closes #<issue>` (when the ticket has one) is what closes the tracker issue:
the merge does it, no extra call. Clean commit messages only - no AI
attribution, no Co-Authored-By. If `gh` is unavailable, signal `stop`: a merge
that no tool has checked against CI is not one the loop makes.
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
