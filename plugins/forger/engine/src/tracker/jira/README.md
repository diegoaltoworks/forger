# tracker/jira

The Jira text, the Jira call and the tracker port over them.
Only `tracker.ts` runs a command.

## Files

- `adf.ts` - the node and mark types, and the lists of nodes and marks the
  markdown conversion writes.
- `adf-to-markdown.ts` - `adfToMarkdown`. Reads paragraphs, headings, lists,
  task lists, code blocks, rules, hard breaks and the marks `code`, `strong`,
  `em` and `link`. Text is never escaped. A node it does not know keeps its
  text.
- `call.ts` - `jiraCall`, the `curl` command of one call. It names the two
  credential variables and never holds their values; they reach `curl` through
  a config on standard input.
- `tracker.ts` - `jiraTracker`, the port over the call, with the three status moves.
- `pr-title.ts` - the title `KEY-<n>: <summary>` and the ticket a leading key names. Pure.
- `jql.ts` - a string as a JQL literal.
- `status/` - the status moves as decisions. See its README.
- `markdown-to-adf.ts` - `markdownToAdf`. Writes a version 1 document with only
  the written nodes. A checkbox item is a plain list item that begins `[ ]` or
  `[x]`. It writes markdown with no node of its own as paragraph text.

## May import

Its own types and pure functions, the config's settings types and `quote`. No adapter.
