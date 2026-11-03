# The measures report cost and rework per merged ticket

Status: Proposed

`/forger:retro` and `measure` are the basis of the claim that forger measures itself. The owner asked whether that holds: do they report cost per merged ticket, and how often merged work is reworked? This record answers from running them on this repository, and designs what is missing. The findings with their evidence are in the pull request that carries this record.

## Context

What `measure` reports today, and from where:

| Measure | Source | Caveat |
|---|---|---|
| Runs, failures by cause | per-iteration logs (`outcome`) | none |
| Terminal events | the event log | none |
| Time per ticket | `elapsed` in the iteration log | wall time of the worker run, not of the ticket from pick to merge |
| Budget per ticket | `Ticket: <id> [<model>, $<cap>]` in the work log | the cap handed to the session, not its spend |
| CI rounds per ticket | pull-request runs per branch from `gh run list` | the branch-to-ticket match is broken for GitHub tickets (see below) |

Two defects sit inside what already exists:

- **Budget is not cost.** The worker is started with `--max-budget-usd`; nothing records what the session spent, so the field reads as a cost and is a ceiling.
- **CI rounds never attach to a GitHub ticket.** `normalizeBranch` turns `feat/issue-72` into `issue_72`, and the ticket id is `issue-72`, so the lookup misses and every branch lands in `ci_rounds_unmatched`.

## The wanted measures

| Measure | Status | Deterministic source |
|---|---|---|
| Cost per merged ticket | derivable | the session transcript named by the session id (token usage per message) times a price table kept as data; the work log carries the session id prefix and the ticket, the merged PR closes the issue |
| Time per merged ticket | present, partial | the iteration log gives worker time; pick-to-merge time is the pick event to the PR's merge time from the tracker |
| CI rounds per ticket | present, broken | fix the branch match; same source |
| Rework | derivable | git history and the tracker: a later PR whose diff touches lines a recent merged PR added or removed, or a revert commit, or an issue that names a merged PR as its cause (`Fixes`, `Reverts` or a "follow-up to #n" reference) |
| Escaped defects | derivable | issues of type bug that name a merged PR, counted against merged tickets |
| Owner interventions | derivable | approvals asked, HALT cleared by a human and work-order notes, as events; today only terminal events are logged |
| Pick-versus-built mismatch | derivable | the pick event's ticket against the ticket the worker's PR closes; today the pick is only in the work log |

## Options

1. **Report everything in `measure`.** One command, one JSON document. Simple, but the owner's report then carries retro-only detail (per-pair rework lines, CI rounds) and grows without bound.
2. **Split by audience.** `measure` stays the full, machine-readable document for retros. The owner's report (`report`) takes a fixed small subset. Chosen.
3. **Record spend in the engine** by running the agent with a JSON output mode. Exact, but harness-specific and so against ADR 0005; the transcript route works for any harness that leaves a transcript, and degrades to "unknown" for one that does not.

## Decision

Option 2, with cost read from the session transcript by a pure function over parsed usage records and a price table held as data (a project may override it). Every measure is a pure function over named inputs with a table test; the CLI gathers the inputs and does no arithmetic (ADR 0002).

Defaults chosen, for the owner to overturn:

- **Rework window:** a later change counts as rework when it lands within a window of merged tickets (default the five after the original), so the number does not drift with the calendar.
- **Cost when no transcript exists:** unknown, never the cap.
- **In the owner's report:** cost per merged ticket, rework rate, escaped defects and owner interventions, since each is a number the owner acts on. **Retro only:** time split, CI rounds, pick-versus-built mismatch and rework pairs, since they locate a cause and rarely change a decision on their own.

## Consequences

- The `budget_usd` field is renamed to say it is a cap, and a separate `cost_usd` appears beside it, so no reader mistakes one for the other.
- Events grow beyond terminal ones: the pick, and interventions. The event log's shape is stored data, so the change needs a test (the safety pack).
- Build tickets, filed awaiting triage and blocked in order: fix the branch-to-ticket match; session cost from transcripts; pick and intervention events; rework and escaped defects; the owner's report subset.
