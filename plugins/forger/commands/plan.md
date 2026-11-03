---
description: Grill the user to turn intent into a documented plan, tracker issues and backlog tickets
disable-model-invocation: true
allowed-tools: Bash(*), Read, Write, Edit, Glob, Grep, AskUserQuestion, Task, TodoWrite, WebSearch, WebFetch
---

# Plan - ground, scope, grill, crystallise

This is an **interactive** planning session. You read the project, establish what
it is, scope the session to one enhancement or a small set, then **grill the
user** until the plan is clear enough to write real work items. Then you
crystallise it: a plan doc, tickets in the loop's shape, and issues on the
tracker. You do NOT implement anything and you do NOT guess intent: you draw it
out by questioning, reflect it back, document it, and add the tickets to the backlog.

The goal is clarity, not exhaustiveness. Stop when the user is satisfied and
there are enough well-formed tickets to hand to `/forger:work`.

## Environment

- **Domain glossary (`GLOSSARY.md`):** !`test -f GLOSSARY.md && echo present || echo absent`
- **Wayfinder maps on the tracker:** !`gh issue list --label wayfinder:map --state all --json number,title,state --jq '.[] | "#\(.number) \(.title) (\(.state))"' 2>/dev/null || echo "none, or gh unavailable"`

## Skill slots

Some steps below are skill slots: the project may plug an installed skill into
each. Resolve them once, up front:

```
bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" skills --json
```

For a slot, when `use` is `skill`, invoke the skill named in `skill` and let it
do that step. When `use` is `builtin`, do the step yourself as written here, as
you also do when the tool fails. Never name or choose a skill yourself.

Slots used here: `interview` (step 3), `glossary` (steps 3 and 4) and `design` (step 5).

## 1. Ground yourself (before asking anything)

Read enough to hold an intelligent conversation - do not interrogate the user for
what the repo already tells you:
- `.claude/process.md` (the rules and gotchas), `.claude/workloop.config.json`
- `.claude/backlog.json` and `.claude/backlog.md` - what is already queued or done
- `GLOSSARY.md` and `docs/adr/` if present - the vocabulary and the decisions
  already made; use the glossary's terms from here on
- The repo's docs (architecture / domain / decisions / any phase docs) and README
- A quick structural pass over the code (top-level dirs, entry points) so you can
  speak to where things live

**If a phase doc, spec issue, or design note already covers the intended work,
read it and let it answer as many questions as it can - then only grill the
gaps.** A well-written doc should make this a short conversation.

**If a wayfinder map covers this area**, read the map body. Its "Decisions so
far" are settled: never re-grill them, cite them. Its open child tickets are
decisions still in fog: if the work you are about to plan depends on one, tell
the user the route is not clear yet and offer two exits - resolve it with
`/wayfinder` first, or scope this session to what the map already settled.

Then **reflect back a short grounding summary**: what the project is, its stack,
what is already in the backlog, and the current direction as you read it. Ask the
user to correct anything before you proceed. This proves you did the reading and
anchors the interview.

## 2. Scope the session

Ask what they want to achieve. Frame it as an enhancement or small set of them,
not "the whole roadmap". Use `AskUserQuestion` when a few concrete directions help
them choose, but always leave room for their own answer. Capture the goal in your
own words and confirm it.

This scope bounds step 3: "nothing left to decide" means nothing left to decide
**for this goal**, not for the project.

## 3. Grill until the plan is clear

Run the interview in the `interview` slot, or yourself when it is `builtin`, in this shape:

- Map the decisions as a tree. The **frontier** is every question whose
  prerequisites are settled. Ask the whole frontier in one round, numbered, each
  with a recommended answer, then wait. Recompute the frontier from the answers
  and ask the next round. A question that depends on another still open in this
  round belongs to a later round.
- Facts are your job, never the user's: look up anything the filesystem or tools
  can answer, with sub-agents where it helps.
- Challenge terms against `GLOSSARY.md` and stress-test with edge cases. Record
  new terms and notable decisions as they settle, in the `glossary` slot or, when
  it is `builtin`, in `GLOSSARY.md` and `docs/adr/`.
- Do not move on until the frontier is empty for this goal and the user confirms
  a shared understanding.

Cover as far as the goal needs (not more):
- **Scope & boundaries** - what is explicitly in, and what is out of scope.
- **Problem & why** - the underlying need, so tickets solve the right thing.
- **Constraints** - compatibility, data-safety, performance, deadlines, and the
  gotchas in `process.md`.
- **Shape of the work** - which areas/modules, what patterns to reuse, likely
  ordering and dependencies, where the test seams are.
- **Acceptance** - how each piece is known to be done; what a test would assert.
- **Priority & effort** - relative importance and rough size per item.
- **Open questions / blockers** - anything only the user (or a third party) can
  resolve.

The user sets the depth. Periodically offer an exit: "I have enough for N
tickets - keep going, or shall I write these up?" If the user goes quiet on
detail, propose a reasonable default and ask them to confirm or adjust rather
than stalling.

## 4. Document the plan

When the user is ready, **write it down** - clarity is the deliverable, not just
tickets. Create or update a short planning doc (e.g. `docs/plan-<slug>.md`)
capturing: the goal, what is in and out of scope, the build order, and any open
questions/blockers. Keep it durable and qualitative - no counts, dates, or
transient specifics. Decisions recorded as ADRs are linked
from the plan, not restated in it; a decision lives in one place.

## 5. Draft the tickets

Turn the agreed plan into tickets in the `process.md` shape, for
`.claude/backlog.json` `features`. Each ticket:
- is a **vertical slice**: one iteration of work, a complete path through every
  layer it touches, demoable or verifiable on its own (split anything larger; a
  wide mechanical refactor is sequenced expand, migrate in batches, contract);
- names the files it touches and the patterns to reuse, as hints for a worker
  starting cold, not as a contract;
- has testable acceptance criteria written in the glossary's vocabulary;
- carries `priority`, `effort`, and `depends_on` for a mechanical build order.

A ticket that changes a screen gets its wireframe first, in the `design` slot,
when `docs/design/wireframe.css` exists (the ui pack is installed). Built-in:
copy `docs/design/example/` to `docs/design/<ticket>/`, replace the boxes, run
`screenshot --wireframe <ticket>`, and link the page and the images from the
ticket's Design review section. Label the build ticket `needs-human` and note
that it waits for the owner to approve the wireframe; the owner removes the
label to release it.

Show the user the drafted tickets and get a final confirmation before writing
anything.

## 6. Publish to the tracker

Read `tracker.kind` from `workloop.config.json`.

**`github`:** one issue per ticket, in dependency order (blockers first) so edges
can reference real numbers. Then:
- `gh issue create --title "<ticket title>" --label <tracker.label> --body "<body>"`
  with a body of: what to build (end-to-end behaviour), acceptance criteria as
  checkboxes, and a `Blocked by` list.
- Wire `depends_on` as GitHub's native blocked-by dependency where available
  (`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker database id>`;
  the database id is `gh api repos/<owner>/<repo>/issues/<n> --jq .id`). Fall
  back to the `Blocked by: #n` line if dependencies are unavailable.
- Record each number on its ticket as `issue`. Check for an existing issue with
  the same title first; adopt it rather than duplicating.

**`local` or `none`:** skip this step.

## 7. Commit and hand off

Write the tickets to `.claude/backlog.json`, update `.claude/backlog.md` with the
human summary grouped by priority, then one commit touching only the plan and
the backlog (ADRs and `GLOSSARY.md` edits ride in the same commit):
```
git add .claude/backlog.json .claude/backlog.md docs/ GLOSSARY.md
git commit -m "Plan <theme>: <short list of items>"
```
Then report: the goal, the tickets created (ids, issue numbers, priority, build
order), the plan doc path, and any open blockers. Tell the user they can run
`/forger:work` to start implementing, or `/forger:plan` again to plan
the next enhancement.

## Rules
- Grill; never assume. Draw the plan out of the user by questioning.
- Scope first, then grill: the frontier is bounded by this session's goal.
- Clarity over completeness - a few solid tickets beat a sprawling half-baked one.
- Document the decisions, then add the tickets to the backlog. Do NOT implement.
- The user controls when to stop; always leave them an exit.
