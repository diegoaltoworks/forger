---
description: Onboard this repo for the work loop - templates, tracker, and labels
disable-model-invocation: true
allowed-tools: Bash(*), Read, Write, Edit, Glob, Grep, AskUserQuestion
---

# Setup - onboard a repo

Scaffold what the loop needs in this repo, once. Idempotent: never overwrite a
file the repo already has; report what exists and what you added.

## Environment

- **Git remote:** !`git remote get-url origin 2>/dev/null || echo "no origin"`
- **Existing `.claude/` files:** !`ls .claude 2>/dev/null || echo "none"`
- **Tracker doc (`docs/agents/issue-tracker.md`):** !`test -f docs/agents/issue-tracker.md && echo present || echo absent`
- **`gh` auth:** !`gh auth status >/dev/null 2>&1 && echo ok || echo "not authenticated"`
- **Bun:** !`bun --version 2>/dev/null || echo "not on PATH"`

## 1. Templates

Copy each template from `${CLAUDE_PLUGIN_ROOT}/templates/` into `.claude/` only
if the target does not exist:

```
mkdir -p .claude
for f in workloop.config.json process.md backlog.json; do
  [ -e ".claude/$f" ] || cp "${CLAUDE_PLUGIN_ROOT}/templates/$f" ".claude/$f"
done
```

Then append the per-run state to `.gitignore` if the lines are missing:
```
.claude/state.json
.claude/work.log
.claude/output/
.claude/HALT
.claude/runner.lock
.claude/events.jsonl
```

## 2. Minimal config

Ask, with `AskUserQuestion` where a few options fit:
- the **gates** command (propose one from `package.json` scripts or the repo's
  CI config if you can read one);
- the **base branch** (default: the current default branch).

Write them into `.claude/workloop.config.json`. Leave everything else at its
default.

## 3. Tracker

Decide `tracker.kind`:
- If `docs/agents/issue-tracker.md` exists, it already says where issues live.
  Set `tracker.kind` to match: GitHub -> `github`, local markdown -> `local`, anything else -> `none`, and
  tell the user the tracker doc is the authority the commands will follow.
- Else if `origin` is a GitHub remote and `gh` is authenticated: `github`.
- Else: `local`, and say why.

When `github`: create the intake label if missing:
```
gh label create ready-for-agent --description "Fully specified, ready for the work loop" --color 0E8A16 2>/dev/null || true
```
Only this label is the loop's concern.

## 4. process.md

Tell the user `.claude/process.md` still needs its project-specific sections
filled in (what the repo is, the gotchas). Offer to draft "What this repo is"
from the README now; leave the gotchas to them, since those are the things a
careful reader would not guess.

## 5. Report

List what was created, what already existed, the tracker decision and why, and
the next step: `/forger:plan` to plan the first tickets, or
`/forger:work` if the backlog already has real tickets.

## Rules
- Never overwrite an existing file; add, don't replace.
- Do not create tickets or issues here.
- Do not commit; leave the scaffold for the user to review.
