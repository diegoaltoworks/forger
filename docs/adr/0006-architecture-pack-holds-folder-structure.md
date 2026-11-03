# The architecture pack holds folder structure: a README per folder, imports through the entry

A structure that exists because one worker tidied it will decay unless something enforces it. We added two checks to `check arch`, configured by an optional `modules` key in `.claude/architecture.json`: every declared folder has a `README.md` (`architecture.module-readme`), and code outside a declared folder imports it only through its entry file (`architecture.public-entry`). We chose enforcement in the pack over a convention in the docs, following determinism first (ADR 0002), so every project that installs the pack gets the same guarantee.

## Consequences

- The layer map gains a `modules` key; absent, neither rule applies, so existing projects are unchanged.
- Both rules are pure functions over the tracked paths and the import graph, and both are waivable by opinion id.
- Forger declares its engine source folders, so a new folder needs a README and a deep import is a failing gate.
