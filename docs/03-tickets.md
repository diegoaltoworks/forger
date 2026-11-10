# Tickets and PRs

A worker starts cold. The ticket is everything it knows about the request, so a
ticket is written to be implemented without guessing and without asking.

## A good ticket

- **A vertical slice.** A narrow, complete path through every layer it touches,
  verifiable on its own, sized to one fresh context window.
- **The owner's words.** The request quoted, not paraphrased, so the worker can
  judge intent when the spec runs out.
- **Investigated first.** The supervisor reads the code and the logs before
  filing, and names the likely cause with file paths. A ticket that says where to
  look saves a worker an hour.
- **Defaults stated.** Where a choice was needed, the ticket makes it and says
  so ("defaults for the owner to overturn"). A ticket never stalls on an open
  question it could have answered with a safe bet.
- **Testable acceptance.** Checkboxes a reviewer can tick from the running app or
  the test output.
- **Guards named.** The guarantees the change must keep, listed when the ticket
  is written: a rule that contradicts one is a design question, not a CI surprise.
- **Cheap assumptions measured first.** An assumption that takes minutes to
  measure (a width, a size, a timing) is a Probe, so a ticket that rests on a
  false one is handed back before an hour of build.
- **Knock-on named.** The tests, fixtures, shared screens and documents the
  change reaches, found before coding, not one CI run at a time.

## Criteria that can be checked

A criterion nobody can check gets disputed by the verifier or blocks correct
work. Each acceptance criterion takes one of four forms:

| Form | Example |
|---|---|
| A named test that must pass | "`parse.test.ts` covers a blank line" |
| A command with its expected exit code or output | "`bun run check` exits 0" |
| A number with a unit and a source | "slope error within the `slope` row of the spike's thresholds table" |
| A named UI state from `ui.json`, with its assertions or a screenshot | "the `empty` state shows the prompt" |

"The screenshots match the boards" and "matches the boards" cannot be judged by
the verifier, which cannot compare two pictures. Use a named UI state with
assertions instead, or `Merge: owner reviews` with captioned screenshots for the
owner to compare.

A source is a spike's thresholds row, an ADR or a cited reference. A spike
records its numbers in the thresholds table of its template (quantity, value,
unit, tolerance, source), and build tickets cite its rows.

A command that only counts a phrase in a file or lists files (`grep`, `ls`,
`test -f`, `cat ... | wc`) proves the words or the file exist, not that the
behaviour is right, and a worker can meet it to the letter. When every
criterion of a ticket is of that kind, `check ticket` warns to
"name a test or a journey that shows the behaviour" (it never refuses); one criterion that names
a test drops the warning, and so does a ticket that touches only Markdown.
`Gates green` and a `check docs` command are not counted either way. Instead of
"`grep -c "retry" src/fetch.ts` prints at least 1", write "the test `fetch
retries a failed request once` passes".

Subjective words ("sharpens", "better", "nice", "looks right", "fast") fail a
criterion; a project adds its own under `criteria.subjective_words` in the
config. `check ticket <n>` reports the failing criteria. The engine runs the same
check before a pick: a failing ticket swaps the intake label for `needs-info`,
gets a comment naming the criteria, and is skipped. A supervisor runs it before
filing, and the build tickets `auto-plan` writes must pass it.

## Sections

Every issue body carries these sections. A section that does not apply says so
in one line ("Design review: none"), so its absence is a decision, not an oversight.

| Section | Holds |
|---|---|
| Owner request / Problem | the owner's words, and what is wrong or wanted |
| What exists / Likely cause | what the supervisor found in the code, logs or data |
| What to build | the change, with the defaults chosen, and which journey of the product brief it serves or that it is upkeep |
| Acceptance | testable checkboxes |
| Placement | the folder each piece of new code goes in, as backticked paths, or "none". A missing section warns in `check ticket`; a folder that is frozen or recorded over its limit in the structure baseline is refused unless the ticket moves files out of it or is blocked by an open ticket labelled `structure` |
| Guards | the guarantees (test floors, budgets, baselines, thresholds) the change must keep, each with its file and value, or "none"; `facts --guards <path>...` lists the guard files, the tests naming the paths and the journeys (journeys pack) whose paths match. A missing section warns in `check ticket`, an empty one is refused |
| Probe | optional: commands that measure the assumption the ticket rests on, each a backticked command with its expected result in the forms of acceptance criteria (`exits 0`, `prints "text"`, `prints a number of at least N`), or "none". The engine runs them before it starts a worker; a failure hands the ticket back as `needs-human` without spending a run. `check ticket` refuses a probe line with no expected result |
| Merge | who merges: `when green` (the default when the section is missing) or `owner reviews`. The plan commands choose `owner reviews` when the acceptance includes a judgement only the owner can make, and say why |
| Knock-on | tests, fixtures, shared regions, stored shapes it reaches |
| Sequencing | optional: a line naming another open ticket that shares ground with this one and which of the two re-measures if the order changes. `check ticket` fails two open tickets whose Knock-on paths or modules overlap unless one blocks the other, natively or under Blocked by, or a Sequencing section names the other; a ticket with no footprint is not compared |
| Docs, examples and help | every doc, worked example and help article to update, in every offered language |
| Design review | the design boards to redraw and review |
| Languages | the wording added or changed, and that every offered language needs it |
| Decisions | "none" until the owner answers a question about the ticket; `decide <n> "<text>"` appends each answer with who and when, and an entry overrides the earlier text where they disagree; `check guards` lets a loosened guard through only when an entry names its file |

The sections a project needs grow with the project. Each one above was added
after a gap cost something; see `05-refining-the-process.md`.

## A creative brief

A request about look, feel or play (a demo, a game, a pitch, "think <X>") has
creative intent, which `work intent --request <text> --json` detects and
explains with its signals. `/forger:plan` then runs a creative-brief round before
the usual questions and records the owner's answers in the plan doc:

- **Brief, verbatim.** The owner's words, unedited, at the top of the plan doc.
  Tickets quote it, and review judges the build against it, not against a
  tidied summary.
- **Interpretation of references.** Each reference (a *reference* in the
  glossary) is read for feel, charm and readability, not copied as a spec. The
  plan states the reading so the owner can correct it before any ticket is cut.
- **Contrasting options.** A creative choice (look, interaction model, tone) is
  put as two or three different options with a preview each, never as one
  recommended answer. A tidy default is how a faithful but lifeless build happens.

A creative ticket carries the brief as its owner request and names the moment
the audience must feel as acceptance.

### Toy first

Slicing by layer (model, then renderer, then flow) suits a product and fails a
creative brief: every ticket passes and nobody can enjoy the result until the
last one, by which time nobody is looking. For creative intent the order is:

1. **The toy.** The first ticket makes the core interaction playable end to end
   with placeholder art: a person can do the thing the brief is about, and the
   thing answers every action. Its acceptance names the moment the audience must
   feel, and the owner plays it before the next ticket starts.
2. **The style pass.** Look, colour, character and motion, judged against the
   brief and its previews.
3. **Rigour.** Models, settings, real numbers and extrapolation, behind the
   interaction that already works.
4. **Polish.**

Determinism still applies. The toy is allowed to be rough, but each decision it
makes is moved into a tested command as soon as it stops being a guess; the toy
is a first slice, not an exemption from principle 0.

`/forger:plan` and `/forger:auto-plan` apply this order when `work intent`
says the request is creative, and put the toy at the head of the dependency
chain.

## Labels

| Label | Means |
|---|---|
| `ready-for-agent` | build it |
| `needs-triage` | a spike's output, waiting for the owner's review |
| `ready-for-human` | only a person can do it (accounts, dashboards, decisions) |
| `needs-info` | waiting on an answer |

## The PR

- Title: what the user gets, in plain words.
- Body: what changed and why, `Closes #<n>`, and review sections matching the
  ticket's ("Design to review", "Languages to review"), so the owner reviews
  exactly what changed.
- One PR per ticket: code, tests and docs together. Squash-merge.
- Push the branch the moment the gates are green, before anything slow, so work
  cannot be lost to a timeout.

## The backlog entry

```json
"<ticket_id>": {
  "priority": "P0",
  "status": "not_started",
  "type": "feature",
  "depends_on": [],
  "effort": "medium",
  "issue": 42,
  "title": "the issue title",
  "description": "What and why, enough to start without guessing.",
  "acceptance_criteria": ["The acceptance criteria on issue #42"],
  "files": ["hints for a cold start; they go stale"],
  "reuse": ["the pattern or reference to follow"]
}
```

`depends_on` is what stops a worker building on a base that lacks its
prerequisite. Set it whenever order matters; prose in the work order alone is
not enough for the engine.

The Placement section is what the worker follows when it adds a file; `## Structure` in the project's process file holds the convention behind it.
