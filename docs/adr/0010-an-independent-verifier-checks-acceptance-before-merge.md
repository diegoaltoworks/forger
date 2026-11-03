# An independent verifier checks acceptance before merge

Status: Proposed

The worker builds the change, reviews it and ticks the acceptance boxes. Gates and CI prove the code compiles and its tests pass; nothing independent checks that each acceptance criterion holds against the built result, or that the tests test what the ticket asked. A self-certified "done" is a decision the model makes about its own work, which principle 0 forbids (ADR 0002).

## What the dry run showed

A by-hand pass over an already merged PR (recorded in the spike's PR body) shows what a verifier gets and what it cannot get:

- Most criteria resolve to a file, a named test or a command: "refuses on a failed check" is a test name in `loop/merge.test.ts`; "`check docs` rejects a raw `gh pr merge`" is a fixture test in `checks/docs/docs-check.test.ts`; "no raw merge in commands" is a grep that returns nothing. Those are checkable from the diff and the tree, with evidence that can be resolved by a tool.
- Some criteria are about the world after the merge ("CI on `main` is green"). They resolve to a fact the engine already reads (the PR's checks), not to the diff.
- Some are judgement ("every decision is a tested command, not prompt text"). A verifier can cite where each decision lives, but "cannot tell" is an honest answer for part of it, and the design needs a place for that answer.

## Options

- **(a) A review step inside the worker's run.** Cheapest, but the same context that built the change reads it, so it inherits the worker's reading. This is the existing `review` slot and stays advisory.
- **(b) A fresh-context verifier whose verdict the merge tool enforces.** A separate agent run receives the ticket, the diff and the built result, and returns a structured verdict. The merge tool refuses without a passing verdict for the PR head.
- **(c) (b) plus mechanical criteria taken out of the verifier's hands.** Criteria that a check can decide are decided by the check; the verifier gets only the rest.

## Recommendation: (c)

Defaults chosen, for the owner to overturn:

1. **Where it sits.** After the PR opens, before merge, as a fact the merge tool reads. The worker runs `verify --pr <n> --json`; the `merge` command refuses unless a current passing verdict record exists for the PR's head commit. A push after verification makes the record stale. The engine's outcome decider treats a merged PR with no passing verdict for its head as `unverified`, a failure that halts like `merged-red`, so skipping the step is caught from facts and not trusted to prose.
2. **What it receives.** An input built by a pure function: the ticket's acceptance criteria, the diff against the base, and the gate result for the PR head, with a read-only checkout of the head to run commands in. It never receives the worker's transcript, the PR body or the commit messages, which are the worker's claims. It runs on its own role (`verifier` in the config, ADR 0005), defaulting to a tier other than the worker's where the config has one, so it does not share the worker's blind spots.
3. **What it outputs.** A JSON record: the PR, the head commit, the ticket, and one entry per criterion with a verdict of `met`, `not_met` or `cannot_tell` and evidence, each item a file with line, a command with captured output, or a test name. A pure validator rejects a record that omits a criterion, adds one the ticket does not have, or gives `met` or `not_met` without evidence whose reference resolves; an unresolvable `met` is demoted to `cannot_tell`. A second pure function reduces the record to `pass` (all met), `block` (any not met) or `unclear` (none not met, some cannot tell).
4. **The tool that enforces it.** `merge` calls the reducer. `block` and `unclear` both refuse; the refusal names the criteria. A missing or stale record refuses.
5. **`cannot_tell`.** It blocks, like `not_met`, because letting the model pass what it could not judge restores self-certification. It gets one resolution route: the worker makes the criterion decidable (adds a test, a command, a clearer assertion) and re-verifies. A criterion that is `cannot_tell` twice is reported to the owner as one to reword or make mechanical.
6. **Stopping a verifier and a worker looping on each other.** Verification is bounded to a number of rounds per PR (default two). The verifier cannot edit; the worker cannot edit the record. After the last round the ticket is labelled `needs-human`, the unmet and unclear criteria are commented on the issue, and the run ends as a recorded failure that counts toward the stall counter (ADR 0008).

## How it relates to the rest

- **The `review` slot** is the worker's own pass before the PR. It stays, and stays advisory: it finds cheap faults early, and nothing depends on it.
- **`check`** decides what can be decided mechanically over the tree. The verifier decides whether the ticket's own words hold. Neither replaces the other.
- **The spec pack (ADR 0007)** moves criteria across the line. A criterion bound to a satisfied requirement is recorded `met` with the spec check as evidence and is left out of the verifier's input. The more requirements are bound, the less the verifier has to judge.

## Cost and time

One extra agent run per verified head commit, bounded by the round limit and by the same run timeout as a worker, plus the cost of running the cited commands in a checkout. The input carries the diff and the criteria and not a transcript, so it is much smaller than a worker's context. The measures command reports how often the verifier blocked a merge and how often a later failure was one it had passed, so the owner can see whether it earns its cost and tune the tier.

## Consequences

- Every decision above is a pure function (criteria parsing, the input, the validator, the reducer, the round bound, the outcome table) or a tested command (`verify`, `merge`); the verifier prompt keeps only the judgement of whether evidence supports a criterion.
- A weak or vague acceptance criterion now fails visibly as `cannot_tell` instead of being ticked, which pushes ticket quality up at the cost of some extra rounds.
- The verifier is a model, so it can be wrong. Unresolvable evidence is demoted by the validator, and the measures expose a verifier that passes work that later fails.
- Build work is filed as separate tickets awaiting triage: the verdict schema, the `verify` command, merge enforcement and the outcome, the round bound, then mechanical criteria with the measures.
