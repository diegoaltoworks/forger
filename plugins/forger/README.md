# `forger` plugin

This folder is the forger plugin: the commands, the engine, the packs and the skills that the loop runs. To install and use it, read the [root README](../../README.md).

| Folder | What it holds |
|---|---|
| `commands/` | The slash commands, one file each |
| `engine/` | The engine, a tested Bun project; start at [`engine/src/README.md`](engine/src/README.md) |
| `bin/work.ts` | The engine entry that the commands call |
| `packs/` | The opinion packs that a repository adopts |
| `skills/` | Forger's own steps for the skill slots |
| `evals/` | The cases that score a skill on a slot |
| `flavours/` | The shipped skill flavours |
| `pipeline/` | The pipeline definition |
| `templates/` | The files that `setup` copies into `.forger/` |

The reference pages are in [`docs/reference/`](../../docs/reference/README.md).
