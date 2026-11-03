# Notes for the owner

What only the owner can do. Workers and the supervisor add to this; the owner
clears items.

## Owner steps

- **Scoped GitHub token for the loop.** The machine-wide `gh` account is a
  different one; start the engine with
  `GH_TOKEN=$(gh auth token --user <owner-account>)` in its environment only.
- **Run the engine from source**: `bun plugins/forger/bin/work.ts run --continuous`
  from the repository root.
- **The worker is forger itself**, installed at local scope from this checkout:
  the plugin install commands in the plugin README's install section, with
  this checkout as the marketplace and `--scope local`.
- **Create `.forger-denylist`** (untracked) with the personal and
  project-specific terms the docs check must reject, one per line.
