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
