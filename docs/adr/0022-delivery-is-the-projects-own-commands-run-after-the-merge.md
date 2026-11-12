# Delivery is the project's own commands, run after the merge

Status: Accepted

The owner agreed that forger acts after the merge, opt-in, through the project's own commands, with rollback only when one is configured.

## Context

A ticket is done when its pull request merges with green checks. Nothing deploys the build, checks that it runs, or reverts it.

## Decision

Forger holds no deploy logic and no credentials. The `delivery` pack is opt-in and not installed by default. Its `.forger/deliver.json` names a required `check` command, an optional `deploy` and an optional `rollback`, with a timeout for each step. A pure function plans a delivery from that file: deploy then check, and for a failed step the rollback when one is configured, else nothing. A failed check after a merge files a ticket and rolls back only when a rollback is configured. Nothing in this pack runs before the merge. `check delivery` validates the file and runs none of the commands.

## Consequences

- A project keeps its deploy tooling and secrets where they are.
- Without a rollback, a failed delivery files a ticket and leaves the build as it is.
- Wiring the plan into the engine is a separate step.
