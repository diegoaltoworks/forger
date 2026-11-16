# The tracker is a port with an adapter per kind

Status: Accepted

The owner agreed that Jira becomes a tracker kind, and that the engine gets one place where a kind is added.

## Context

The engine read and wrote its tracker from many files of its own. Each built a `gh issue` or `gh label` command, and many first compared `config.tracker.kind` with `github`. A tracker of another kind had to be added in every one of those places, and a place that was missed did nothing and said nothing.

## Decision

The `Tracker` port (`ports/tracker.ts`, types only) is what the engine asks of a tracker about a ticket, named by its number.

- Reads are methods: a ticket's text, labels, state with the pull requests that close it, last comment, whether it exists, a list of tickets by label, state and title, and the labels the repository has.
- A write is data, a `TrackerWrite`. One method applies it and returns what the tracker answered. The decision to write is then a pure function that returns writes and is tested with no tracker.
- The port says where the backlog is, in the tracker or in a file, so a caller asks the port and does not compare the kind.
- The `Backlog` interface stays the port for selection. Selection has rules of its own: page sizes, a query's cost, the blockers of a blocker.
- Pull requests and checks stay on the code host. The code host is not the tracker.
- A ticket keeps its number whatever the tracker; a tracker whose tickets have another key maps it to a number.
- A command has two ways to run a program, one that lets a failure through and one that reports it. The tracker is built over both, and a caller says which answer it wants, so no call changes how it fails.
- There is no tracker that does nothing. `local` and `none` say where the backlog is; a ticket named by a number is read from GitHub for them.

The sites that read a ticket's text move first; the rest follow in their own changes.

## Consequences

- A tracker of another kind is one adapter and one line in `openTracker`.
- A test that fakes `gh` where the command runs fakes the tracker too.
