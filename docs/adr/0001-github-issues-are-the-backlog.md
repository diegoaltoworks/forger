# GitHub Issues are the backlog

The engine reads the backlog through one interface with two implementations: GitHub Issues (the default) and a `backlog.json` file (the fallback, for repos with no tracker or no access). On GitHub, an open issue carrying the intake label is a ticket not started; an issue closed by a merged PR is completed; `needs-human` and `deferred` labels carry those statuses; priority and effort are labels; `depends_on` is GitHub's native blocked-by. We chose this over keeping `backlog.json` as the source of truth with issues as a mirror because the mirror drifted and had to be maintained by hand, and because "completed" can then mean "closed by a merged PR" - a fact GitHub records - instead of a status a worker writes before its merge lands.

## Consequences

- `backlog.md` is dropped: the issue list is the human view.
- The engine needs `gh` and network access to select work in the default mode; the file implementation keeps it working offline.
