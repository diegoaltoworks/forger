# The tracker

How the engine reads GitHub Issues as the backlog.

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

