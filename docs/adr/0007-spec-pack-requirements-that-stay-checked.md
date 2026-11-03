# A spec pack keeps requirements checked, backed by SLCR

Status: Proposed

Opinions (how work is done) are enforced on every PR by `check`. Requirements (what the product must do) are not: an issue's acceptance checkboxes are ticked by the worker, the PR merges, and nothing looks at them again. Behaviour drifts and nobody has a cheap way to find out. [SLCR](https://github.com/wack/slcr) is an MIT-licensed format and reference tool that stores requirements as a graph with stable IDs and a MUST/SHOULD/MAY modality, prints a `slice` of one requirement and the context it needs, and runs validators that report each requirement as satisfied, unsatisfied or unknown. This ADR proposes a `spec` opinion pack built on it, and what forger takes from the idea even where it does not use the tool.

## The pack

The spec holds the current state; the issue is the unit of change. They refer to each other in one direction only:

- A ticket carries a `Satisfies:` line naming requirement IDs. `intake` writes or updates the requirements first, then files the issue naming them.
- The spec never names an issue. IDs never change and issues are transient; the history of a requirement is the history of the spec file in git.
- The worker reads `slice` for each named ID instead of the whole spec.
- `check spec` joins three facts and decides purely from them: the IDs the PR's issue names, the requirement report, and the base branch's report. It fails when a named requirement is unsatisfied or unknown, and when any MUST that was satisfied on the base is no longer satisfied.

Pack opinions: `spec.ticket-names-requirements` (check), `spec.named-requirements-satisfied` (check), `spec.must-never-regresses` (check), `spec.validator-not-requirement` (rule: a failing validator means the code or the validator is wrong, never the requirement; the requirement changes only through intake).

## Options for the integration

- **(a) Call the `slcr` binary.** The pack runs `slcr check --json` and `slcr slice` through the engine and parses the output at the boundary. Cheapest; follows the format for free; adds an external install and a dependency on a young tool's output shape.
- **(b) A TypeScript core.** Read spec and validator files, the `vet` rules that matter, `slice`, and `check` with validators run through the engine; leave out the query engine, tool download and install, and rendering. No install, but forger owns a format that is still moving, and compatibility is a standing cost.
- **(c) Both.** The decision core is pure over a normalized report. The binary is the first provider of that report; a TypeScript provider reads the same format later. Either provider yields the same report type, so the check does not care which ran.

## Recommendation: (c), binary first

Forger takes no hard third-party dependency, so the binary must be optional, and the pack must work when it is absent only in the sense of saying so: `check spec` reports a coverage gap it cannot measure, never a silent pass. But the format is young, so building (b) before a real product has used the pack would freeze guesses. Defaults chosen, for the owner to overturn:

1. Ship the pack on provider (a) behind a port, with the pure decision core and a normalized report type.
2. Try it on a product repo (the sample repository from the sample-repo spike if it exists by then), not on forger.
3. Build the TypeScript provider only after the trial, and prove compatibility against SLCR's own `SPEC.slcr.toml`, its fixture specs and its snapshot outputs as fixtures. Carry the MIT notice with any copied fixture.

## What forger takes regardless of SLCR

- **Unknown is a state.** A check result gains an explicit coverage gap: not passed, not failed, not measured. Today a missing check is indistinguishable from a passing one.
- **Modality sets severity.** MUST fails, SHOULD warns, MAY informs, mapped onto the existing rungs and waivers, so a SHOULD is a waivable warning and a MUST is not waived without an approver.
- **Checks by descriptor.** A check declared as data (a command, its arguments, its pass codes) instead of hand-written TypeScript, so a pack can add a check without engine code.
- **A failing validator is never an invitation to loosen the requirement.**

## Adoption on an existing repo

Requirements cannot be written retroactively for everything. The path is from now on: a ticket that changes behaviour must name requirements, and writing them is the cost of the ticket. Existing behaviour stays unknown until touched. The measure that shows progress is the share of requirements that are unknown, reported by `check spec --json` on each run, so the trend is read from the reports and not from prose.

## Consequences

- Every decision above is a pure function over a normalized report or a tested command (ADR 0002); the prompt keeps only the judgement of how to word a requirement.
- Build work is filed as separate tickets awaiting triage: the pack and decision core, the binary provider, the first product trial, then the TypeScript provider and the shared unknown state.
