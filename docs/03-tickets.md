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

A source is a spike's thresholds row, an ADR or a cited reference. A spike
records its numbers in the thresholds table of its template (quantity, value,
unit, tolerance, source), and build tickets cite its rows.

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
| What to build | the change, with the defaults chosen |
| Acceptance | testable checkboxes |
| Knock-on | tests, fixtures, shared regions, stored shapes it reaches |
| Docs, examples and help | every doc, worked example and help article to update, in every offered language |
| Design review | the design boards to redraw and review |
| Languages | the wording added or changed, and that every offered language needs it |

The sections a project needs grow with the project. Each one above was added
after a gap cost something; see `05-refining-the-process.md`.

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
