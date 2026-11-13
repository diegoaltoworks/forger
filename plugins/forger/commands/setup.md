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
- **Existing `.forger/` files:** !`ls .forger 2>/dev/null || ls .claude 2>/dev/null || echo "none"`
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

Then ask about skills. List the flavours whose skill collection is installed:
```
bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" skills --presets --json
```
For each one, offer to use it as the flavour; an empty list means ask
nothing. When two or more are listed, also offer the `mixed` flavour, which takes the
strongest fit per slot across the collections. The user can add a flavour of their own in `.forger/flavours/` or map
slots by hand later in `.forger/workloop.config.json`.

Then ask about packs. List the ones the repo's own facts call for:
```
bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" packs --detect --json
```
Each entry carries the rules that matched. Recommend those packs and say why in
the owner's terms; an empty list means ask nothing. The owner chooses, and the
chosen ids go to `--packs` below, after `base`.

## 2. Install

```
bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" setup --json --gates "<gates>" --base-branch "<branch>" --tracker "<kind>" [--flavour "<name>"] [--packs "base,<chosen>"]
```

In a repository with no source file the tool also copies the default starter (a
Bun and TypeScript skeleton) and uses its gates; pass `--no-starter` to copy none
or `--starter <name>` to pick one. A repository with source files gets none.

The tool writes the config (with `check` appended to the gates),
`process.md` with principle 0 and the default gotchas, a starter `backlog.json`,
the ticket, PR, work order, report, retro and rule templates under
`.forger/templates/`, and the per-run `.gitignore` lines. It never overwrites,
and reports each file as `written` or `kept`; a second run writes nothing. The files
come from opinion packs (`--packs`, default `base`), and `.forger/forger.lock.json`
records what was installed.

For each engine runtime file that git already tracks (an ignore line does not stop
that), the report has a `tracked_runtime` list and a line naming the file and
`git rm --cached <file>`. Relay it; setup never runs it.

## Upgrading

When `.forger/forger.lock.json` already exists, the repo is set up and the job is
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

When the testing pack was chosen, the result carries `coverage` and `next_steps`:
whether the gates write the lcov report the pack's `check coverage` needs, and
the flag for the test command the tool recognised. Relay those lines, offer to edit
the gates to write the report, and once a report exists offer
`check coverage --update` to set the first baseline. Do not guess a flag the
tool did not give.

## 3. Label

When the tracker is `github`: create the intake label if missing:
```
gh label create ready-for-agent --description "Fully specified, ready for the work loop" --color 0E8A16 2>/dev/null || true
```
Only this label is the loop's concern.

## 4. process.md

Tell the user `.forger/process.md` still needs its project-specific sections
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
