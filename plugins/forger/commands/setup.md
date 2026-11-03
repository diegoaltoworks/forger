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
- **`gh` auth:** !`gh auth status >/dev/null 2>&1 && echo ok || echo "not authenticated"`
- **Bun:** !`bun --version 2>/dev/null || echo "not on PATH"`

## 1. Ask

Ask, with `AskUserQuestion` where a few options fit, only what the tool cannot
know:
- the **gates** command (propose one from `package.json` scripts or the repo's
  CI config if you can read one);
- the **base branch** (default: the current default branch);
- the **tracker** (`github` when `origin` is a GitHub remote and `gh` is
  authenticated, else `local`; say why).

Then ask about skills. List the presets whose skill collection is installed:
```
bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" skills --presets --json
```
For each one, offer to map it onto the skill slots; an empty list means ask
nothing. The user can map slots by hand later in `.claude/workloop.config.json`.

## 2. Install

```
bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" setup --json --gates "<gates>" --base-branch "<branch>" --tracker "<kind>" [--preset "<name>"]
```

The tool writes the config (with `check` appended to the gates),
`process.md` with principle 0 and the default gotchas, a starter `backlog.json`,
the ticket, PR, work order, report, retro and rule templates under
`.claude/templates/`, and the per-run `.gitignore` lines. It never overwrites,
and reports each file as `written` or `kept`; a second run writes nothing. The files
come from opinion packs (`--packs`, default `base`), and `.claude/forger.lock.json`
records what was installed.

## Upgrading

When `.claude/forger.lock.json` already exists, the repo is set up and the job is
an upgrade, not an install:
```
bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" setup --upgrade --json
```
The tool classifies each installed file by comparing the lock, the disk and the
pack: untouched files take the new version, refined files are kept, new files are
installed, and nothing is deleted. Relay the report. For each path in `review`:
a `conflict` has the pack's version beside it as `<file>.upstream` - show the
difference and ask the owner whether to merge, keep theirs or take the pack's;
a `removed` or `deleted` file only needs mentioning. Once the owner has decided,
delete the `.upstream` file. Do not decide a conflict yourself.

## 3. Label

When the tracker is `github`: create the intake label if missing:
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

Relay the tool's written and kept lists, the tracker decision and why, and
the next step: `/forger:plan` to plan the first tickets, or
`/forger:work` if the backlog already has real tickets.

## Rules
- Never overwrite an existing file; add, don't replace.
- Do not create tickets or issues here.
- Do not commit; leave the scaffold for the user to review.
