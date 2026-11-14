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
each. The pipeline says which slots run in which stage and what fills each:

```
bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" pipeline --json --stage <id> --issue <n>
```

Ask for the stage you are in: `build` (steps 4 and 5), `review` and `risk` (step 6), `pr` (step 8).

For a slot, read `invoke`. `skill`: invoke the skill named in `target`. `file`:
read the file at `target` and follow it. `builtin`: do the step yourself as written
here, as you also do when the tool fails. A slot with `on` runs only when that
event happens. Start every step whose `invoke` is `skill` or `file` with the `preamble` of
`bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" skills --json`, verbatim, and never
invoke a skill listed in its `forbid`. Never name or choose a skill yourself.

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

### Deadline
The prompt and the `FORGER_DEADLINE` environment variable give the run's deadline.
The engine signals you then and ends your process group after a grace period.
Check `FORGER_DEADLINE` before any long wait (a slow gate, a CI wait), and push
the moment the gates are green; a pushed branch survives a kill, a local one does not.

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
- All work happens in your worktree: the loop's checkout is read by path and never entered or written.
- If the issue has a `Satisfies:` line, read the context of each ID it names with
  `bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" slice <ID...>` (exit 2: no spec provider installed; carry on).
- Follow existing patterns - read the files the ticket names and match the code
  around them. `files` and `reuse` are hints, not a contract; the code is.
- **Respect every gotcha in `process.md`.** Those are the repo's hard
  constraints (data-safety rules, forbidden calls, invariants). Treat them as
  enforced, not advisory.
- Separate files per concern where the codebase is organised that way - a new
  responsibility gets a new file, not a section bolted onto an existing one.
- **Place code by feature.** Read `## Structure` in `process.md` (and the
  structure opinions among the installed ones) before adding a file.
  - Find the feature folder the file belongs in. If there is none, create one
    following `## Structure`, named with the glossary's terms.
  - Never add a sibling to a folder that `check structure` reports over its
    limit or frozen; the ticket's Placement section names where it goes.
  - Never name a file with its folder's name as a prefix.
  - When the ticket touches a catch-all file (one that holds many features'
    code), move the touched part to its feature's home instead of growing the file.
  - When logic moves, update its imports. Leave no re-export shim behind.
  - Run `check structure` before committing. A new finding is fixed by moving
    the file, not by waiving it. Only the owner waives.
- Work test-first from the ticket's acceptance criteria, at the highest existing
  seam, in the `test_first` slot. Built-in: write the failing test, make it pass,
  then refactor.
- Pure logic must be pure and tested as such.
- A fix comes with a guard test, and the guard follows `testing.guard-finds-its-cases`:
  it finds its cases by scanning the source for the pattern, never from a list of
  today's files, and you show it failing on the code before the fix.

### 5. Quality gates (must all pass)
Run the gate command from `workloop.config.json` (`gates`). Fix failures; do not
proceed on red. If a gate is red for a reason you cannot see, make one honest
diagnosis attempt in the `diagnose` slot. Built-in: reproduce it, read the
failing output, form one hypothesis and test it. If it is still red, signal `stop`.

`check guards` is among the gates. Never lower a guard, skip a test or delete one to get
green; when the change needs it, ask the owner, who records it with `decide`.

A gate that fails on something your change did not touch is run once more with no
change, never more. A pass on the rerun is a flaky gate: say so in the PR, and
the engine files the ticket. A second failure is real. No test is skipped,
weakened, retried inside the test tool or marked as allowed to fail to get past it.

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
- When the ticket's issue is in the Open table of the failure catalogue
  (`docs/06-failure-catalogue.md`), move that row to the Fixed table in the
  same PR, naming the PR once it is open, and push again before `verify`. A
  row you add yourself for the ticket's own issue ends in Fixed too. Run
  `work catalogue --update` to move it. Before the PR exists `check docs`
  accepts the Open row; once it is open, `check docs` fails on it. On the
  ticket's own branch a Fixed row is accepted while the issue is still open;
  the merge closes it.

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

After `work rebase` rewrites a branch that is already pushed, update it with
`git push --force-with-lease origin <branch>` (the rebase output names it as `next`),
never `-f` or `--force`: the hook refuses those.

```
git push -u origin feat/<ticket-id>     # FIRST - do not defer this
gh pr create --title "feat: <summary>" --body "<what + how + gate results>

Closes #<issue>" --base <base-branch>
bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" verify --pr <pr> --json
bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" merge --pr <pr> --json
git checkout <base-branch> && git pull
```
**Read the ticket's `## Merge` section first.** Missing, or `when green`, means
you merge as below. `owner reviews` means the owner merges: build, run the gates,
open the PR and run `verify` on the criteria a machine can check, then do not run
`merge` (it refuses for such a ticket). Leave the PR open and signal `complete`.
The engine labels the PR and the issue `owner-review`, records an `owner_review`
event and picks the next ticket; tickets blocked by this one wait until the owner
merges the PR. If `verify` does not pass, `handover` applies as for any ticket.

**Never merge red, and never merge by hand.** `merge` waits for every check to
finish, squash-merges only when all passed and `verify` recorded a passing
verdict for the PR's current head (a later push makes it stale; `block` and
`unclear` both refuse and name the criteria), and confirms the merge from the
PR's state; it exits 1 when it refuses. When `verify` or `merge` refuses because the engine's source has
uncommitted changes, the engine's checkout is not yours to repair: do not touch it, do not decline the ticket
(the cause is the checkout, not the ticket), and signal `stop` with the refusal as the reason. The engine halts the loop
and keeps the ticket and its PR for the run after the resume. When `verify` does not pass, run
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
Print the signal once, as the very last thing in your response, and never while
you are still working: not while you wait on a background command, not as a
progress note. The engine takes the last signal in the output as your claim,
and a stop's reason is the text right after the tag, up to the next blank line.

End your response with exactly one:

- `<process>complete</process>` - ticket done, gates green, merged (for an `owner reviews` ticket: PR open and verified).
- `<process>stop</process>` then the reason on the same or next line - blocked /
  needs human input / no actionable ticket.
- `<process>stop conflict</process>` - a design rule and a guarantee cannot both hold. Follow the tag with
  `constraint:`, `measured:` (the gap, a number and a unit), two or three `option:` lines each followed by a
  `tradeoff:` line, and one `recommend:` naming a listed option. The engine rejects an incomplete block and asks
  once more. Never take an option yourself, and never loosen a guard to pass: the owner answers with
  `decide <n> "<choice>"`.

## Rules
- ONE ticket per iteration. Quality gates must pass. Small, clean commits.
- Check the work order first - human instructions win.
- Claim the issue before working it; close it through the PR.
- Never adopt or work an issue whose labels match `tracker.ignore`.
- If blocked, signal `stop` with a clear reason rather than guessing.
- Obey the data-safety and write-scope rules in `process.md` without exception.
