# tracker/jira

The conversion between a Jira document (Atlassian Document Format, a tree of
nodes in JSON) and the ticket markdown the engine reads and writes. Both
directions are pure: no file, network, command, clock or random value.

## Files

- `adf.ts` - the node and mark types, and the lists of nodes and marks the
  markdown conversion writes.
- `adf-to-markdown.ts` - `adfToMarkdown`. Reads paragraphs, headings, lists,
  task lists, code blocks, rules, hard breaks and the marks `code`, `strong`,
  `em` and `link`. Text is never escaped. A node it does not know keeps its
  text.
- `markdown-to-adf.ts` - `markdownToAdf`. Writes a version 1 document with only
  the written nodes. A checkbox item is a plain list item that begins `[ ]` or
  `[x]`. It writes markdown with no node of its own as paragraph text.

## May import

Its own types and pure functions only. No adapter and no dependency.
