# Docs opinions

What the docs pack holds, and why. A rule marked "check" is enforced by
`check docs`; the rest are judgement, kept by whoever writes the docs.

## Markdown in the repository

Docs live beside the code as Markdown. A change that alters behaviour carries
its docs in the same pull request, so the docs are never a step that gets
skipped later.

## Every concept and process gets a diagram

A diagram shows the shape that paragraphs hide. Put a diagram, then one
sentence saying how to read it; a diagram with no reading hint makes the reader
work out what you meant. Diagrams are for processes and concepts; a screen is
drawn as a wireframe (the ui pack's `design` slot).

## The glossary is the vocabulary

Each term in `GLOSSARY.md` names one thing, and its `_Avoid_:` list names the
words that would blur it. Docs use the glossary term. The check flags an
avoided word in prose; wrap it in a code span when you are quoting it.

## A page that shows each feature

Every user-facing feature has a page that shows it working. When the ui pack is
installed the page carries a screenshot, produced by the project's screenshot
command rather than pasted by hand.

## Decisions are ADRs

A decision that shapes the project is written down as an ADR with its context
and consequences, so nobody has to reconstruct why.

## Links, images and diagrams cannot rot

A relative link, an `#anchor` or an image path that points nowhere is a bug the
reader finds first. A mermaid block that does not parse renders as an error.
The check catches both before a merge. Diagram parsing is structural: the
diagram type is known, flowchart brackets and quotes balance, arrows have both
ends and subgraphs close.

## A failure catalogue is two tables

A catalogue of failures is an Open table and a Fixed table, one row per failure,
each row linking its issues and, once fixed, the merged PRs. The row says what
the failure looks like in one line; the issue holds the detail. The tracker
decides which table a row is in. The check fails on an Open row with no open
issue, on a row that disagrees with the tracker, and on an entry section.

## READMEs are a launch pad in Simplified Technical English

Every `README.md` states its purpose first and is written to the measurable
rules of ASD-STE100 (ADR 0017). The check enforces these:

- The first paragraph after the H1 is one or two sentences: what this is and who it is for.
- A step is at most 20 words, a descriptive sentence at most 25, a paragraph at most 6 sentences.
- Use the active voice. A passive construction is a warning, not a failure.
- No transient facts: no counts of files, tests, lines or modules, no dates, no "currently", "recently" or "new", no version number in prose.

Code blocks, code spans and tables are skipped. A README that cannot meet a
rule carries a waiver. The check cannot enforce the controlled dictionary or
whether the purpose is a good one; the writer and the reviewer keep that.
