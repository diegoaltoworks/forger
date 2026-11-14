# The default stack is Bun and TypeScript

Status: Accepted

The owner decided that the default stack is Bun and TypeScript.

## Context

`setup` installed `.forger/` and the packs into whatever it found. In an empty repository that left no code, no gates that run and no CI, so the first loop had nothing to check.

## Decision

A repository with no source file gets a starter from `plugins/forger/starters/`, with Bun and TypeScript as the default. The starter ships a strict `tsconfig.json`, a pure `src/core/`, a `src/shell/`, tests, a CI workflow, one journey and a lockfile. It adds the dev dependencies `typescript` and `@types/bun`. `setup` records the starter's gates in the config and installs the packs it names. A repository with source files keeps its own stack and gets no starter; other stacks bring their own starter, chosen with `--starter`.

## Consequences

- A new repository starts green and runs its gates from the first commit.
- The starter's lockfile is a file forger ships and keeps current.
- A starter never overwrites a file; the starter's choice is a pure function with tests.
