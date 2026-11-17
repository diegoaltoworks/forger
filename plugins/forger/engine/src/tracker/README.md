# tracker

The `Tracker` port's GitHub adapter, and the one place that turns the
configured kind into a tracker. A read is a method and a write is data.

## Files

- `github-command.ts` - the `gh` command of each read and of each write.
  One function quotes a label, a title or a text. Pure.
- `github-tracker.ts` - `githubTracker`, the port over the two command
  functions a command gets. It also answers the account it acts as.
  It answers the supervisor's reads too: tickets with their labels and text,
  existence and state. A call takes the plain one unless the caller asks
  for the whole result.
- `quote.ts` - quotes a label, a title or a text for the shell. Pure.
- `github-graphql.ts` - the GraphQL calls and the parsers of their answers.
  Pure. Three calls read. They give the open tickets with a label.
  They give a ticket's text and blockers with its node id. They give the facts
  of several tickets. One call blocks a ticket by another.
- `filed-labels.ts` - `filedLabels`, the labels of a filed ticket. The caller's
  own, and the intake label when the backlog is in the tracker. Pure.
- `open.ts` - `openTracker`, the tracker for a config's kind. Every kind reads
  GitHub; the kinds differ in where the backlog is. The loop opens one and
  hands it to what hands a ticket back.

## Entry point

`index.ts`. The port's types are in `ports/tracker.ts`.

## May import

The core: `ports`, `config` (the tracker setting). No adapter: all its I/O goes
through the command functions it receives.
