# Engine development

How to build and test the engine itself.

## Engine development

The engine is a real, tested project under `plugins/forger/engine/`:

```
cd plugins/forger/engine
bun install
bun test          # unit tests for config merge, ticket selection, tiering,
                  # prompt building, merge verification, run outcomes, and
                  # stall detection
bun run typecheck # tsc --noEmit
```

Layout - the source is one folder per domain, and the layer is in the path:
the pure core, `adapters/` for the side effects the core is handed, and `cli/`
which wires them together. `check arch` enforces the dependency rule through
`.forger/architecture.json`. Start at [`engine/src/README.md`](../../plugins/forger/engine/src/README.md)
for the folder map; each folder's README says what it owns, which files are
pure, and what it may import. `plugins/forger/bin/work.ts` is the stable entry the plugin
commands call.

Forger runs its own packs. A change to a pack runs `bun plugins/forger/bin/work.ts setup --upgrade`
in this repository in the same PR, and resolves every conflict it reports by hand. A test fails
when the lock falls behind a pack's version or an `.upstream` file is left under `.forger/`.

