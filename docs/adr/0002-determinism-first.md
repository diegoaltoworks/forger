# Determinism first, reasoning between the boundaries

Forger is, at its core, a set of deterministic tools - tested Bun/TypeScript commands with machine-readable output - that let models forge ahead reliably. Every decision that must come out the same every time (ticket selection, status, merge verification, outcome counting, issue sync, doc checks, process measurement) is a tool; skills and commands call the tools and keep only judgement in prose. We chose this over the usual prompt-first plugin because every serious failure in the loop's history was a model or a prompt asked to decide something a command could have decided, and because a rule held in a prompt or a memory note was broken again even after it was written down.

## Consequences

- A ticket that adds or changes a decision lands it as a tested command, not as prompt text.
- When a model gets something wrong that a tool could have decided, the fix is the tool.
- The refinement ladder ends in a tool or a check; prose is a waypoint, not the destination.
