# Plan: from merged tickets to working apps

## Goal

Forger's mission is to build apps that work for the people they are for, and to
do it reliably. Today it does a narrower job well: it turns a well-formed ticket
into a merged, gated, independently verified change. This plan closes the gap
between "the ticket merged" and "the app works and is worth using".

It opens with an assessment of forger as it stands, then lists the work that
follows from it, in order. The assessment is the rationale; the units under
"In scope" are what a planner turns into tickets.

## Assessment

### What holds

- **Decisions live in tools.** The pick, the outcome, the merge and "Gates
  green" are decided from facts, not from what a worker says
  ([principle 0](01-principles.md)).
- **Acceptance is checked by someone else.** A verifier with a fresh context
  checks each criterion before the merge, and guards and ratchets stop a worker
  from loosening the thing that measures it.
- **Failures become rules.** Each one lands in
  [the failure catalogue](06-failure-catalogue.md) and climbs to a rule, a check
  or a tool.
- **Opinions are files the project owns.** A project can read, change and waive
  them ([opinion packs](08-opinion-packs.md)).

These make forger a careful builder of tickets. They do not yet make it a
builder of apps.

### Where it falls short

1. **Done stops at the merge.** Nothing in the engine deploys a build, checks
   that it runs, or hears about it failing afterwards. A ticket can pass every
   gate and leave an app that does not start.
2. **Acceptance leans on text.** The criteria a tool can check most cheaply are
   counts of a phrase in a file. Such a criterion proves the words exist, not
   that the behaviour is right, and a worker can meet it to the letter. The
   catalogue's "faithful but flat" row is the same failure seen from the
   owner's side.
3. **No opinion on what the app is for.** Forger records the owner's request per
   ticket. It holds nothing about who the app serves, the few things they must
   be able to do, or how anyone would know it is working for them. So it cannot
   tell product work from upkeep, or a finished app from a long backlog.
4. **Proven mostly on itself.** Its rules come from failures in a small set of
   repositories, forger first among them: a command-line tool whose behaviour is
   easy to assert. The first replay on the sample repository has not run
   ([#109](https://github.com/diegoaltoworks/forger/issues/109)), so no change
   to the process has been measured against a fixed set of requests.
5. **The process only grows.** Each lesson adds a ticket section, a rule or a
   check. `measure` reports cost and rework per ticket, but nothing reports what
   an opinion costs or how often it catches anything, and nothing retires one.
6. **No stated stack.** Forger takes no position on the stack, and an empty
   repository gets no starting point. Yet its checks quietly do take one: the
   import rules of the architecture pack and the shim rule of the structure
   pack read one family of languages, and a repository in another passes them
   with nothing checked. That breaks forger's own rule that an unreadable
   source is an error, never an empty result.
7. **One ticket in doubt can stop everything.** Some stops already set the
   ticket aside and move on (a declined ticket, a failed probe). Others halt the
   whole loop, including a verifier that cannot tell on one criterion of one
   ticket while unrelated tickets wait.
8. **Whole classes of risk have no opinion.** The safety pack looks for secrets
   and unsafe data changes. Nothing looks at vulnerable dependencies, at who may
   read or change whose data, or at size and speed budgets.

## In scope

Each unit says whether a planner can ticket it now (**Ready**) or what it
waits for. The owner's decisions are recorded in the last section.

### A. Evidence before more rules

- **A1. Run the first replay.** Already tracked:
  [#109](https://github.com/diegoaltoworks/forger/issues/109). The owner has
  given the go-ahead to create the fresh copy of the sample repository.
- **A2. Compare two replays.** Exists: `measure --report` writes the comparison
  report of a run and `measure --diff` compares two. Nothing to build.
- **A3. A process change carries its replay.** A PR that changes a default
  pack, a ticket template or a command's instructions names the comparison of
  two replays in its body; `check` warns when it does not. **Ready** once A1
  has run.

### B. Opinions that earn their place

- **B1. Record which opinion failed.** When a check fails in a worker's gates,
  the engine records an event with the opinion id, the ticket and whether the
  worker then fixed, waived or baselined it. **Ready.**
- **B2. Measure per opinion.** `measure --opinions --json` reports, for each
  opinion with a check, how often it failed, how those failures ended, and for
  each ticket section how often its answer was "none". **Ready** after B1.
- **B3. A way down the ladder.** `retro` can draft the demotion or removal of
  an opinion that never fires or is mostly waived, as it drafts a new rule
  today. The refinement doc says when. **Ready** after B2.

### C. Done means running

- **C1. Journeys.** `.forger/journeys.json` names the few things a person must
  be able to do in the app, each with the command that exercises it against a
  running build. `check journeys` runs them in the gates. A ticket that touches
  a journey's paths names it under Guards. **Ready.**
- **C2. Acceptance prefers behaviour.** `check ticket` warns when every
  criterion other than "Gates green" is a text count or a file listing, and
  the ticket guide says to name a test or a journey instead. **Ready.**
- **C3. A delivery pack.** Opt-in. `.forger/deliver.json` names the project's
  own commands to deploy a build, to check it (the journeys, run against the
  deployed address) and to roll it back. After a merge the engine runs the
  check; a failure files a top-priority ticket that links the merge, and runs
  the rollback when one is configured. Forger calls the project's commands and
  holds no deploy logic or credentials of its own. The first ticket records
  the design as an ADR. **Ready.**
- **C4. Failures in use come back as tickets.** A port for a source of runtime
  errors, with one adapter, that files a deduplicated ticket per new error.
  Waits for C3, and for the owner to name the first source.

### D. What the app is for

- **D1. A product brief.** The plan interview writes `docs/product.md` once:
  who the app is for, what they must be able to do (these become the journeys
  of C1), how success would show, and what is out. The planner reads it before
  it writes tickets. **Ready.**
- **D2. Product work against upkeep.** `measure` reports the share of merged
  tickets that changed a journey's paths against the share that did not. No new
  ticket section. **Ready** after C1.

### E. A paved road

- **E1. Checks say what they can read.** Each check reports the languages it
  understands. A check that finds source it cannot read prints "not applicable"
  with the reason and never a pass, and `setup` lists the installed checks that
  will not apply to the repository. The unit starts with a test that shows
  today's behaviour on a repository in an unread language. **Ready.**
- **E2. The default stack is Bun and TypeScript.** Forger says so in its
  principles and its getting-started guide. `setup` in an empty repository
  builds a running skeleton on that stack unless told otherwise: one journey
  end to end, gates, CI, and the packs configured for it. A repository that
  already has code keeps its stack. Other stacks bring their own skeleton.
  Proved by building a copy of the sample repository from empty. **Ready.**

### F. Keep the line moving

- **F1. Set a ticket aside, not the loop.** When the cause of a stop is one
  ticket (a verifier that cannot tell, a conflict, repeated worker failure),
  the engine hands that ticket and the tickets blocked by it to the owner and
  picks the next ticket that shares no footprint with it. The loop halts only
  when the cause is not a ticket: a failing base branch, an infrastructure
  error, a tampered hook, the budget. **Ready.**

### G. Risks with no opinion

- **G1. Dependency audit.** A safety opinion with a check: `.forger/safety.json`
  names the audit command, and a finding at or above the configured severity
  fails. **Ready.**
- **G2. Budgets as ratchets.** A general ratchet: `.forger/budgets.json` lists
  commands that print one number, each with a direction; the baseline only
  moves the good way, and a branch that worsens it needs the owner's decision.
  The coverage and structure baselines are the pattern. **Ready.**
- **G3. A periodic access review.** The loop files a review of who can read and
  change whose data, on the same schedule mechanism as the structure review
  ([structure](09-structure.md)). **Ready.**

## Out of scope

- A hosted service, and running in CI: tracked in
  [#301](https://github.com/diegoaltoworks/forger/issues/301) and
  [#300](https://github.com/diegoaltoworks/forger/issues/300).
- More harnesses
  ([#275](https://github.com/diegoaltoworks/forger/issues/275)). It waits until
  forger has built one app that people use; reach matters less than proof.
- The base pack's opinions. Its writing rules are forger's own, and forger
  enforces them in every project it sets up. That is intended.
- Forger deploying anything itself. The delivery pack calls the project's
  commands.
- New ticket sections. Every unit here uses a file, a check or a measure.

## Build order

1. B1, C2, E1, G1: small, independent, and each makes a later step
   measurable or honest.
2. A1, then A3. From here a process change is compared, not assumed.
3. C1, D1, then D2 and G2.
4. F1 and E2.
5. B2, then B3.
6. C3, then G3.
7. C4, once its source is named.

## Owner decisions

- **The base pack keeps its writing rules.** They are forger's opinions and it
  enforces them; a new project starts with them.
- **The default stack is Bun and TypeScript** (E2).
- **The loop may set a ticket aside and continue** when the cause belongs to
  that ticket (F1).
- **Forger acts after the merge**, opt-in, through the project's own commands,
  with rollback only when one is configured (C3).
- **The first replay may create its copy of the sample repository** (A1).
- **More harnesses wait** for one app that people use
  ([#275](https://github.com/diegoaltoworks/forger/issues/275)).

Still open: which source of runtime errors C4 reads first.
