# A sample product repository proves forger on something that is not forger

Status: Proposed

Forger has mostly built forger. A loop that is good at changing its own engine and docs has not shown it can build a product: a UI, stored data, a deploy and users who ask for things. Every later step (CI-native mode, evals, the spec pack trial in [ADR 0007](0007-spec-pack-requirements-that-stay-checked.md), parallel workers in [ADR 0011](0011-parallel-workers-scheduled-around-conflicts.md)) needs a second repository to run against, so the evidence is self-referential until one exists.

## 1. What the sample product is

It must be small enough to start in a day, and real enough to need a UI, stored data, a deploy and a long tail of tickets that touch different layers.

| Candidate | UI | Stored data | Deploy | Users | Ticket tail |
|---|---|---|---|---|---|
| **Link stash**: save links, tag them, search, share a list | forms, list, search, empty and error states | links, tags, lists | a static front end and a small API | sign-in, private and shared lists | import, export, duplicates, tag rename, share links, rate limits |
| **Booking page**: a studio lists slots, visitors book one | calendar, confirmation | slots, bookings | front end and API | owner and visitors | time zones, double booking, reminders, cancellation |
| **Shared list**: a household checklist | one screen, live updates | items, members | front end and API | invite, roles | offline, history, recurring items |

Trade-offs: the booking page has the richest correctness rules (time zones, double booking), which suits a spec pack trial, but its domain needs more up-front explanation to a worker and its first day is long. The shared list is the smallest, but its ticket tail runs out quickly and it exercises few layers. The link stash is the middle: nothing in its domain needs explaining, every layer is present, and its requirements (a duplicate is rejected, a shared list is read-only for visitors) are crisp enough to check.

**Recommendation: the link stash.** Defaults chosen, for the owner to overturn: a TypeScript front end and API in one repository, one hosted database, one deploy target, email-and-password sign-in. The product is deliberately ordinary; the point is the loop, not the product.

### The first requests

A fixed, ordered set of owner requests, written once as issues in the sample repository's request file and replayed (section 3). Each is a vertical slice:

1. Save a link from a form and list it.
2. Tag a link; filter the list by tag.
3. Reject a link already saved, saying which one.
4. Search saved links by title and tag.
5. Share a list by a link that is read-only for visitors.
6. Import links from an exported bookmarks file.
7. A bug: a saved link with an unusual address breaks the list (reproduced first, then fixed).
8. A spike: how should the product send a weekly digest.

The last two cover the other kinds of intake (a bug and a spike), so every path the loop has is exercised.

## 2. Where it lives and what it installs

- **Its own repository**, public, owned by the same account as forger and named for the product. It is never a folder inside forger: the point is that forger is installed into it from outside, through `setup`, like any consumer.
- **Packs installed:** `base`, `safety`, `testing`, `ui` and `docs`, chosen by `packs --detect` from the repository's facts rather than by hand, so the detection is exercised too. `architecture` is added once the repository has more than one layer. The `spec` pack is added only after the first requests have merged, so the trial compares a product with and without it.
- **Hosting:** the loop runs locally for the first runs, then through the CI-native mode when it exists.

## 3. What runs against it

Three things, each a command and not a procedure someone follows:

- **Forger's evals.** The setup, intake and ordering evals run against the sample repository as their fixture, so they exercise a real tracker and real packs.
- **The CI-native mode**, once it exists, runs its first scheduled supervisor and dispatched worker here before it touches any other repository.
- **A replayed request set.** The requests in section 1 are stored as data in the sample repository. A pure function turns the set into the issues to file, in order, with their `Blocked by` set. To compare two forger versions, a fresh copy of the repository is created at the same starting commit, the requests are filed, and the loop runs to the end of the set under each version. The comparison is by the measures in section 4, never by reading transcripts.

## 4. The measures that make it evidence

All measures already exist or are small additions to `measure`, so none is collected by hand:

| Measure | Source |
|---|---|
| Tickets merged | the tracker: closed by a merged PR |
| Failures and their causes | `measure` (failures by cause) |
| Cost per merged ticket | the session transcripts' cost of every ticket in the period (merged or not), divided by merged tickets; see [ADR 0013](0013-measures-report-cost-and-rework-per-merged-ticket.md) |
| Rework | CI rounds per ticket (`measure`), plus PRs reopened or followed by a fix for the same ticket |
| Owner interventions | events in the event log of an approval asked, a HALT cleared by a human, or a work-order note |

A run is evidence when it reports all five for the whole request set on a fixed starting commit. A single merged ticket is a demo. The report is one pure function over those inputs, so two versions are compared by diffing two JSON documents.

## 5. The roadmap order

The roadmap lists the sample repository last, under "Generalise", after the hosted app. That order is wrong: the hosted app, the CI-native mode and the evals all need a second repository to be shown working, and a hosted app built before any product has been driven would be designed against forger alone. **Recommendation:** the sample repository moves ahead of the off-the-machine steps, and the CI-native mode names it as its first target. The roadmap is changed in the same change as this record.

## Consequences

- Every decision above is a pure function over data or an existing command (ADR 0002): turning the request set into issues, computing the comparison report, and choosing packs from facts.
- Nothing in forger is specific to the link stash. The sample repository's requests and packs live there; forger holds only the replay and the comparison.
- Build work is filed as separate tickets awaiting triage: create the repository with forger installed, add the request set and its replay, add the comparison report, then run the first replay.
