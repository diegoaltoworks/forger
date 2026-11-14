---
description: Unattended - turn a spec, phase doc, resolved wayfinder map, or ready-for-agent issues into queued backlog tickets
allowed-tools: Bash(*), Read, Write, Edit, Glob, Grep, Task, TodoWrite, WebSearch, WebFetch
---

# Auto-plan - autonomous ticket generation

The **non-interactive** planner. Given something that already specifies the work,
it converts it into workable tickets in one pass, with no questions asked - so it
can run unattended (for example when the loop empties the backlog and a spec for
the next chunk already exists). If the direction is still open and needs a human,
use `/forger:plan` instead; this command does not interview and does not
guess past what its source supports. It produces tickets only - it does NOT
implement.

## Environment


The tracker settings are in `.forger/workloop.config.json`; its conventions are in
`.forger/process.md`.

## Read first
1. `.forger/process.md` - the ticket shape, the gotchas, the tracker rules
2. `.forger/workloop.config.json` - `repo`, `tracker`, paths
3. `GLOSSARY.md` and `docs/adr/` if present - write tickets in the glossary's
   vocabulary and respect the ADRs in the area you touch
4. `.forger/backlog.json` - what already exists, so you do not duplicate it
5. `.forger/human.md` - known blockers
6. The product brief: `work.ts facts --product`. When it reports `present: false` or `problems`, plan only what the source states and mark each such ticket as upkeep; do not invent a brief
7. The source (next section)

## The source

The user names it as the argument, or you take the first that applies:

- **A spec or phase doc** in the repo (`docs/plan-*.md`, a phase doc, a design
  note). The classic input.
- **A tracker issue** (number or URL): fetch its full body and comments with
  `gh issue view <n> --comments`. A spec published by `/to-spec` looks like this.
- **A wayfinder map** (an issue labelled `wayfinder:map`, or a `map.md` under
  `.scratch/`). It is a source only when its route is clear: **no open child
  tickets**. Then the spec is its Destination plus its "Decisions so far"; zoom
  into closed tickets (`gh issue view <n> --comments`) for the detail behind any
  gist you need. If the map still has open children, stop and report that the
  route is not clear yet; the human resolves it with `/wayfinder`.
- **Adopt mode** (no doc at all): open issues carrying `tracker.label` that are
  not yet in the backlog (no ticket has their number as `issue`). Anything
  a human or another tool published as agent-ready. Each such issue
  becomes one ticket; its `Blocked by` list or native blocked-by dependencies
  become `depends_on`. **Never adopt an issue labelled `wayfinder:*`**: those are
  decisions, not work.

## Your task

### 1. Confirm the source is sufficient
This command needs a source that actually specifies the work: rationale, the units
of work, and ideally a build order. **If nothing sufficient exists, or it is too
vague to produce testable tickets, do NOT invent scope** - stop and report that
`/forger:plan` is needed to establish intent first. Guessing here is the
failure mode this command must avoid.

### 2. Draft the tickets
For each unit of work the source describes, produce a ticket in the `process.md`
shape. Good tickets:
- are **vertical slices** - one iteration, a complete path through every layer
  they touch, verifiable on their own; split anything larger; sequence a wide
  mechanical refactor as expand, migrate in batches, contract;
- name the **files** they touch and the **patterns** to reuse, as hints for a
  cold worker (read the code to fill these in; do not copy stale paths from
  the source);
- say in `What to build` which journey of the product brief the ticket serves, or that it is upkeep (no new section);
- carry a `## Merge` section: `when green`, or `owner reviews` when the acceptance includes a judgement only the owner can make (taste, an approved baseline), with the reason stated in the ticket;
- carry a `## Placement` section: the folder each piece of new code goes in, as backticked paths, or "none", taken from `## Structure` in process.md and `.forger/structure.json`. When a planned change has nowhere to go (its folder is frozen or recorded over its limit), file a ticket labelled `structure` that makes the folder, and list it under `## Blocked by` of the ticket that needs it (a missing section warns, a flagged folder with neither the move nor the blocker is refused);
- carry a `## Guards` section: each guarantee the change must keep (a test floor, budget, baseline or threshold) with its file and value, or "none"; start from `work.ts facts --guards <paths the ticket touches>` (an empty section is refused, a missing one warns);
- have **testable** acceptance criteria, each a named test, a command with its expected result, a sourced number or a named UI state (`work.ts check ticket <n>` on the filed issue must pass; otherwise the engine skips it as `needs-info`);
- carry `depends_on` so the order is mechanical;
- name a `repo` if the work belongs to another codebase;
- state whether they write to a datastore, with the safety argument if the repo
  has write-scope rules.

When the source's request is creative (`work intent --request <text> --json`
says `creative`), do not slice by layer: the first ticket is the toy, the core
interaction playable end to end with placeholder art, and every other ticket
depends on it, in the order style pass, rigour, polish (`docs/03-tickets.md`,
"Toy first"). If the source is a layered plan for creative work with no toy
ticket, add one at the head rather than copying the layers.

Prefer fewer, well-specified tickets over many vague ones. In adopt mode the
issue already says what to build; your job is to add what the loop needs
(priority, effort, files, reuse, `depends_on`) by reading the code, not to
rewrite it.

### 3. Publish to the tracker (`tracker.kind` = `github`)
For each ticket that does not already have an `issue`, create one in dependency
order (blockers first): `gh issue create --title "<title>" --label <tracker.label> --body "<what to build, acceptance criteria as checkboxes, Blocked by list>"`.
Then run `link-blockers --issue <n>` for each issue created, which links every
issue under its `Blocked by` heading as a native blocked-by. If the source was
an issue, reference it as the parent in each body and do not close or modify it.
Record each number on its ticket as `issue`. **Check for duplicates by title
first.** `local` or `none`: skip this step.

### 4. Add them to the backlog
Add every ticket to `backlog.json` `features`. Update `.forger/backlog.md` with a
human summary grouped by priority.

### 5. Commit
One commit touching only the backlog and docs:
```
git add .forger/backlog.json .forger/backlog.md docs/
git commit -m "Queue <theme>: <short list of items>"
git push
```

### 6. Report
Summarise: the source, how many tickets, their issue numbers, the build order,
and any human blockers. Be explicit about what the loop cannot self-serve.

## Rules
- Never invent scope the source does not support. No source, or a vague one ->
  stop and point at `/forger:plan`.
- A wayfinder map with open tickets is not a source yet.
- Never adopt `wayfinder:*` issues.
- Do not implement anything. This command only produces tickets.
