# critique

Holds a visual change to the owner's verbatim brief. Findings above a threshold become tickets.

## Files

- `critique.ts` - the pure decisions. Is the change one the audience sees? What is the brief? Which findings are filed? How does a finding read as a ticket?
- `run.ts` - `critiquePr`. It runs the critic in a disposable copy of the PR's head and validates the `critique` contract. It files tickets through an injected tracker and writes the record. Everything it touches is injected.

A critique never blocks a merge. It feeds the backlog.

## Entry point

`index.ts`.

## May import

`checks` (glob matching), `config`, `pipeline` (the contract), `ports`.
