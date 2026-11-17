# The tracker

How the engine reads GitHub Issues as the backlog.

## The port and its adapters

The engine asks a tracker about a ticket through the `Tracker` port
(`plugins/forger/engine/src/ports/tracker.ts`), recorded in
`docs/adr/0023-the-tracker-is-a-port-with-an-adapter-per-kind.md`. Reads are
methods; a write is data (`TrackerWrite`) that one method applies. The port
also says whether the backlog is in the tracker or in a file, so a caller does
not compare the kind, and names the account it acts as, which is who a recorded
decision is attributed to.

What a hand-back does is decided once, as writes, and each tracker says how:

- a decline is a label change (intake label out, `needs-info` in) and a comment;
- a hand-over, a failed probe and a ticket set aside are the `needs-human` label
  and a comment, and the first two then take the intake label off;
- the owner's answer is two writes, `needs-human` removed and then the intake
  label added, so the first can hold when the second fails;
- an owner review marks the issue with a label write; the pull request is on the
  code host and keeps its own `gh pr edit` command;
- `setup` creates the labels a repository lacks with label-creating writes.

The tickets the engine files go through the same tracker: a flaky gate, a
periodic review, a failed delivery, a critique's findings, the ticket for a
revert and a replay's requests are file writes, and a later sighting is a
comment on the open ticket found by a list of tickets by state, label and
title. One function gives a filed ticket's labels: the labels the caller names,
and the intake label when the backlog is in the tracker. The loop's status issue
(the halt signal) is one ticket found by its title, the lowest number when
several match; setting it is a comment and a label write, clearing it a label
write, and a pin that fails does not fail the rest.

The supervisor reads through the tracker too: the tickets of a query with their
number, title, labels and text (what waits on the owner, the rework measure and
the merged tickets' texts), whether a ticket exists (what `resume` checks when
the backlog is in the tracker), a ticket's state with the pull requests that
close it (`facts`), and the tickets labelled `structure` (a ticket check's
placement context). The tracker also says what a person runs to list the
tickets with a label, so the recommendation printed when a read fails comes
from the adapter.

Three reads are GraphQL queries and one write is a GraphQL mutation: the open
tickets with a label, each with its text and its native blockers (a ticket
check compares with them; a failure carries the tracker's own error); one
ticket's text, native blockers and the tracker's own reference for it; and, for
a list of tickets, whether each is closed and which merged pull request closed
it (the failure catalogue is checked against these). The write blocks one ticket
by another, named by those references: the port does not say what a reference
is, so GitHub uses a node id and another tracker can use its key. Which blockers
to link stays a pure decision over the ticket's text.

A function that applies these reads the ticket's labels back through the same
tracker to check the label held.

The GitHub adapter lives in `plugins/forger/engine/src/tracker/`. `openTracker`
gives it for every kind, since a ticket named by a number is read from GitHub
whatever the kind; `local` and `none` differ in where the backlog is. A command
reaches the tracker through its context's `tracker()`. Selection stays with the
`Backlog` interface, and pull requests stay on the code host.

## Tracker: GitHub Issues

With `tracker.kind` `github`, the issues are the backlog (see
`docs/adr/0001-github-issues-are-the-backlog.md`). The engine reads them with
one `gh api graphql` query and maps them to tickets:

| On the issue | On the ticket |
|---|---|
| open, with the intake label | `not_started`, id `issue-<n>` |
| closed by a merged PR | `completed` |
| closed any other way | `closed` - not done, and not work to start |
| `needs-human` / `deferred` label | `needs_human` / `deferred` |
| `P0`-`P3` label | `priority` (none reads as P3; ties go to the older issue) |
| `effort:small` / `effort:medium` / `effort:large` | `effort` |
| native blocked-by | `depends_on` |
| a label matching `tracker.ignore` | not a ticket |

A blocker that is not itself a ticket (no intake label, or ignored, such as a
decision) is satisfied once it is closed. A `gh` failure stops the engine
rather than reading as an empty backlog, and its error quotes what `gh` printed.

The query reads the open intake issues and only the most recently closed ones;
a dependency's status comes with the blocker itself, so the closed history is
never scanned. Its page sizes are kept small, and a test holds the query's
worst-case rate-limit cost, computed from the query text, to a stated budget. A
list longer than its page fails the read rather than dropping a blocker. The
engine reads the backlog once per iteration (after the worker runs) and reuses
it; one `status` or `backlog` call is one read.

- **Planners** create one issue per ticket (intake label, blocking edges as
  GitHub's native blocked-by dependencies).
- **The worker** branches as `feat/issue-<n>`, claims the issue by assigning
  itself, and puts `Closes #n` in the PR body so the squash merge closes it.
  The merge is the status update.

With `local` or `none`, `backlog.json` is the backlog and the worker sets a
ticket's `status` there in its PR.

