<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/lockup-dark.svg">
    <img alt="forger" src="assets/brand/lockup-light.svg" height="72">
  </picture>
</p>

# forger

Forger runs an unattended development loop that builds your backlog one ticket at a time. It is for developers who want a model to ship tested, reviewed pull requests while tested commands hold every decision.

[![CI](https://github.com/diegoaltoworks/forger/actions/workflows/ci.yml/badge.svg)](https://github.com/diegoaltoworks/forger/actions/workflows/ci.yml)

## 📦 Install

You need [Bun](https://bun.sh), `gh` and one supported harness. Forger runs in Claude Code. Adapters for OpenCode, Codex and Copilot exist and are not yet proven by a real run; see [adapters](docs/reference/adapters.md). Pick your row.

| Harness | Install |
|---|---|
| Claude Code | `claude plugin marketplace add diegoaltoworks/forger`, then `claude plugin install forger@forger` |
| OpenCode | This adapter is not yet proven by a real run. `git clone https://github.com/diegoaltoworks/forger ~/forger`, then in your repository `bun ~/forger/plugins/forger/bin/work.ts setup --harness opencode` |
| Codex | This adapter is not yet proven by a real run. `git clone https://github.com/diegoaltoworks/forger ~/forger`, then in your repository `bun ~/forger/plugins/forger/bin/work.ts setup --harness codex` |
| Copilot | This adapter is not yet proven by a real run. `git clone https://github.com/diegoaltoworks/forger ~/forger`, then in your repository `bun ~/forger/plugins/forger/bin/work.ts setup --harness copilot` |

Setup installs the same guards in every harness. Full steps for each harness: [Getting started](docs/getting-started.md). What each harness adapter does: [Adapters](docs/reference/adapters.md).

## 🚀 Start

Open a session at the root of your repository and run the three steps in order.

| Harness | Setup | Plan | Work |
|---|---|---|---|
| Claude Code | `/forger:setup` | `/forger:plan` | `/forger:work` |
| OpenCode | `/forger-setup` | `/forger-plan` | `/forger-work` |
| Codex | `$forger-setup` | `$forger-plan` | `$forger-work` |
| Copilot | `/forger-setup` | `/forger-plan` | `/forger-work` |

- Setup adds the loop's files under `.forger/`.
- Plan interviews you and writes the first tickets.
- Work starts the loop and reports each merge or halt.

What each step prints, and what to do on a halt: [Getting started](docs/getting-started.md).

## 💡 Why

- **Determinism first.** Tested commands make every decision that must come out the same. The model only does the judgement work.
- **Quality from commands.** The worker runs the same gates as CI and merges only through a tool that refuses red.
- **Bring your own skills.** Forger has its own step for each point of judgement. You can map any installed skill onto it.

## 📚 Learn more

| Read | For |
|---|---|
| [About forger](ABOUT.md) | The ideas, the diagrams and the opinion packs |
| [Getting started](docs/getting-started.md) | From nothing to a running loop |
| [Principles](docs/01-principles.md) to [Opinion packs](docs/08-opinion-packs.md) | The process, in reading order |
| [Configuration reference](docs/reference/configuration.md) | Every config field |
| [Commands reference](docs/reference/commands.md) | Every command |
| [Reference index](docs/reference/README.md) | The tracker, skill slots, pipeline, adapters and engine |
| [Structure decays between tickets](docs/09-structure.md) | Why gates per ticket miss structure, and what prevents it |
| [Failure catalogue](docs/06-failure-catalogue.md) | Failures seen in real runs, and their fixes |
| [Roadmap](docs/07-roadmap.md) | What comes next |
| [Glossary](GLOSSARY.md) | The vocabulary |

## 📄 Licence

MIT. See [the licence](LICENSE).
