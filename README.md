<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/lockup-dark.svg">
    <img alt="forger" src="assets/brand/lockup-light.svg" height="72">
  </picture>
</p>

# forger

Forger runs an unattended development loop that builds your backlog one ticket at a time. It is for developers who want a model to ship tested, reviewed pull requests while tested commands hold every decision.

[![CI](https://github.com/diegoaltoworks/forger/actions/workflows/ci.yml/badge.svg)](https://github.com/diegoaltoworks/forger/actions/workflows/ci.yml)

## Install

```
claude plugin marketplace add diegoaltoworks/forger
claude plugin install forger@forger
```

You need Bun, the `claude` CLI and `gh`. Full steps: [`docs/getting-started.md`](docs/getting-started.md).

## Start

Run these in a session at the root of your repository:

```
/forger:setup
/forger:plan
/forger:work
```

- `/forger:setup` adds the loop's files under `.forger/`.
- `/forger:plan` interviews you and writes the first tickets.
- `/forger:work` starts the loop and reports each merge or halt.

What each step prints, and what to do on a halt: [`docs/getting-started.md`](docs/getting-started.md).

## Why

- **Determinism first.** Tested commands make every decision that must come out the same. The model only does the judgement work.
- **Quality from commands.** The worker runs the same gates as CI and merges only through a tool that refuses red.
- **Bring your own skills.** Forger has its own step for each point of judgement. You can map any installed skill onto it.

## Learn more

| Read | For |
|---|---|
| [`ABOUT.md`](ABOUT.md) | The ideas, the diagrams and the opinion packs |
| [`docs/getting-started.md`](docs/getting-started.md) | From nothing to a running loop |
| [`docs/01-principles.md`](docs/01-principles.md) to [`docs/08-opinion-packs.md`](docs/08-opinion-packs.md) | The process, in reading order |
| [`docs/reference/configuration.md`](docs/reference/configuration.md) | Every config field |
| [`docs/reference/commands.md`](docs/reference/commands.md) | Every command |
| [`docs/reference/`](docs/reference/README.md) | The tracker, skill slots, pipeline, adapters and engine |
| [`docs/06-failure-catalogue.md`](docs/06-failure-catalogue.md) | Failures seen in real runs, and their fixes |
| [`docs/07-roadmap.md`](docs/07-roadmap.md) | What comes next |
| [`GLOSSARY.md`](GLOSSARY.md) | The vocabulary |

## Licence

MIT. See [`LICENSE`](LICENSE).
