# 1. Bun and TypeScript

Status: accepted

## Context

The project starts from an empty repository and needs a stack that runs, tests
and type-checks with few moving parts.

## Decision

Bun runs the code and the tests, and TypeScript in strict mode checks it. The
code is split into `src/core/` (pure decisions) and `src/shell/` (input and
output); the shell may import the core and never the other way round, as
`.forger/architecture.json` records.

## Consequences

- One runtime for code, tests and installs; installs come from the lockfile.
- A different stack replaces this skeleton, and the change comes with a new ADR.
