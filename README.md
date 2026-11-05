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

```
claude plugin marketplace add diegoaltoworks/forger
claude plugin install forger@forger
```

You need Bun, `gh` and an agent harness. The commands above are for Claude Code; forger also runs under OpenCode, Codex and Copilot, set with `setup --harness` (see [Adapters](docs/reference/adapters.md)). Full steps: [Getting started](docs/getting-started.md).

## 🚀 Start

Run these in a session at the root of your repository:

```
/forger:setup
/forger:plan
/forger:work
```

- `/forger:setup` adds the loop's files under `.forger/`.
- `/forger:plan` interviews you and writes the first tickets.
- `/forger:work` starts the loop and reports each merge or halt.

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
| [Failure catalogue](docs/06-failure-catalogue.md) | Failures seen in real runs, and their fixes |
| [Roadmap](docs/07-roadmap.md) | What comes next |
| [Glossary](GLOSSARY.md) | The vocabulary |

## 📄 Licence

MIT. See [the licence](LICENSE).
