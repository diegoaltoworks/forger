# Notes for the owner

What only the owner can do. Workers and the supervisor add to this; the owner
clears items.

## Owner steps

- **Scoped GitHub token for the loop.** The machine-wide `gh` account is a
  different one; start the runner with
  `GH_TOKEN=$(gh auth token --user <owner-account>)` in its environment only.
- **Run the engine from source after the timeout fix merges**:
  `bun plugins/forger/bin/work.ts run --continuous` from the repository root.
  Until then the installed loop plugin's engine runs it; watch those runs.
- **Install forger locally when it is ready to try**, beside the existing loop
  plugin: `claude plugin marketplace add <path-to-this-checkout>` then
  `claude plugin install forger@forger`. Then switch `worker_command` to
  `forger:auto-ticket`.
- **Create `.forger-denylist`** (untracked) with the personal and
  project-specific terms the docs check must reject, one per line.
