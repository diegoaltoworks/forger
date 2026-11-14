# Getting started

This page takes you from nothing to a running loop, one command per step. Each
step says what the command prints, so you know it worked. The detail behind each
step is in [Install reference](reference/install.md).

## 📋 1. Check the prerequisites

You need [Bun](https://bun.sh), one supported harness and, for a GitHub
tracker, an authenticated `gh`. The harness is Claude Code (`claude`),
OpenCode (`opencode`), Codex (`codex`) or Copilot (`copilot`). Only Claude Code
is proven by a real run; the other three are not yet proven (see
[Adapters](reference/adapters.md)).

```
bun --version
gh auth status
```

Each prints a version or `Logged in`. A `command not found` names the tool to
install first. Then check the harness you chose:

```
claude --version    # Claude Code
opencode --version    # OpenCode
codex --version    # Codex
copilot --version    # Copilot
```

## 📦 2. Install forger

Pick the harness you use. Forger decides the same things in each; only the way
you install it and the way you start a step differ.

### 🤖 Claude Code

Add the forger repository as a marketplace once, then install the plugin. A
local checkout works as well as `owner/repo` on GitHub.

```
claude plugin marketplace add <path-or-owner/repo>
claude plugin install forger@forger
```

The second command confirms the install. Restart the harness, then type
`/forger` in a session: the forger commands appear in the list. To update
later, see [Install reference](reference/install.md#install-and-update).

### 🧰 OpenCode, Codex and Copilot

These harnesses are not yet proven by a real run, and have no forger plugin. Clone the repository once, anywhere on
the machine. The engine needs no install step.

```
git clone https://github.com/diegoaltoworks/forger ~/forger
```

Then, in the repository you want the loop to work on, run setup with your
harness. It writes the forger commands where the harness reads them:
`.opencode/commands/` for OpenCode, `.agents/skills/` for Codex and
`.github/skills/` for Copilot. It also installs the guard that refuses a worker's
hand merge and push to the base branch, in the way each harness documents:
a plugin for OpenCode, a hook file for Codex and Copilot. In Codex, trust the
project and review the hook with `/hooks`.

If git already tracks one of the engine's runtime files, setup (and `setup --upgrade`)
names it with the `git rm --cached` command that stops tracking it and keeps the
file. Setup never runs that command.

```
bun ~/forger/plugins/forger/bin/work.ts setup --harness opencode    # OpenCode
bun ~/forger/plugins/forger/bin/work.ts setup --harness codex    # Codex
bun ~/forger/plugins/forger/bin/work.ts setup --harness copilot    # Copilot
```

Run only the line for your harness. It prints every file as `written` or
`kept` and records the harness in `.forger/workloop.config.json`, so the
engine starts its workers with it. To update later, pull the clone and run the
same line again: it rewrites the commands that changed.

Workers run on this machine unless you say otherwise. To run each worker in
its own container instead, add `--sandbox docker`. The image is yours: forger
ships none, so name one in `.devcontainer/` or as `sandbox_image` in the config,
and test it with `check sandbox`. Setup records the choice and checks that the
Docker API is reachable, saying how to fix it when it is not, rootless mode
included. The [Run sandboxed](run-sandboxed.md) guide walks through it.
Choose how the worker pays for the model with `--credential api_key` or
`--credential subscription`; for a subscription, setup says how to make a token
for headless use. Put the token in the environment that starts the run. A run
pushes with one GitHub token scoped to the repository, read from a variable or
minted per run from a GitHub App. The
[adapters reference](reference/adapters.md#credentials-in-a-sandbox) lists the
variables per harness.

## 🛠️ 3. Set up the repository

Open a session at the root of the repository you want the loop to work on and
run the setup command for your harness.

| Harness | Command |
|---|---|
| Claude Code | `/forger:setup` |
| OpenCode | `/forger-setup` |
| Codex | `$forger-setup` |
| Copilot | `/forger-setup` |

It asks for the gates command, the base branch and the tracker, and offers
skill flavours and opinion packs. It then prints every file under `.forger/`
as `written` or `kept`, and the tracker it chose and why. It never overwrites
a file, so a second run prints only `kept`.

By default it installs the `base` and `structure` packs. The structure pack keeps
the source tree's shape under a check; setup records the structure that already
exists as a baseline so the repository starts green and only improves, and it
prints any boundary groups it derived from your workspaces so you can widen them.

In a repository with no source file, setup also copies the default starter: a
Bun and TypeScript skeleton with a pure `src/core/`, a `src/shell/`, tests, a CI
workflow and one journey. It sets the gates to the starter's own and installs
the `architecture`, `testing` and `journeys` packs configured for those folders.
`--starter NAME` picks a starter by name (an unknown name lists the available
ones) and `--no-starter` copies none. A repository that already has source
files gets no starter, and setup never overwrites a file the starter also ships.

With a GitHub tracker it also creates the intake label. To create it by hand:

```
gh label create ready-for-agent
```

Then fill in `.forger/process.md`: what the repository is and its gotchas. The
worker treats the gotchas as rules.

## 📝 4. Plan the first tickets

Use the row for your harness.

| Harness | Command |
|---|---|
| Claude Code | `/forger:plan` |
| OpenCode | `/forger-plan` |
| Codex | `$forger-plan` |
| Copilot | `/forger-plan` |

The planner reads the repository, asks you numbered questions, each with a
recommendation, and then writes a plan doc and the tickets. On GitHub each
ticket is an issue with the `ready-for-agent` label. It ends with the goal and
the tickets it created, in build order.

The first time, it also writes a product brief to `docs/product.md`: who the app
is for, the few things they must be able to do, how success shows and what is
out. Setup installs the template as `.forger/templates/product.md` and never
writes the brief itself. Every ticket then says which of those journeys it
serves, or that it is upkeep. `work.ts facts --product` prints the brief and
what is missing from it.

## 🚀 5. Start the loop

Use the row for your harness.

| Harness | Command |
|---|---|
| Claude Code | `/forger:work` |
| OpenCode | `/forger-work` |
| Codex | `$forger-work` |
| Copilot | `/forger-work` |

The supervisor starts one engine, or attaches to the one already running. It
prints the engine's pid and the first ticket, then reports each event as it
lands: a merged ticket, a halt or a stall. Run it again at any time: it never
starts a second engine.

## 👀 6. Watch it

The engine CLI answers the same questions from a shell. In the commands below,
`<forger>` is the plugin folder (`plugins/forger` in a checkout of this
repository).

```
bun <forger>/bin/work.ts status
bun <forger>/bin/work.ts backlog --json
```

`status` prints whether the engine is alive, the counters, the current ticket
and the next pick. `backlog` lists the workable tickets.

## 🩹 7. Recover from a halt

The loop halts on trouble it cannot fix alone, such as a red merge or an
authentication error. The work command and `status` print the reason. Fix the
cause first: look for a pushed branch with no merged pull request. Then clear
the halt and start again, saying why it was safe to clear. Give the issue that
fixes or tracks the cause, or, for something that was not a defect such as a
transient outage, the reason:

```
bun <forger>/bin/work.ts resume --cause <issue>
bun <forger>/bin/work.ts resume --not-a-defect "<why>"
```

`resume` without either refuses and clears nothing. The counters reset so the
next run starts fresh, but the failure is kept: the `halt_cleared` event records
it with your cause or reason, and `report` and `retro` read it. A halt cleared
by removing the tracker's halt label is recorded as uncaused, and `report` lists
it under waiting on you. Then run the work command for your harness, from the
table in [step 5](#5-start-the-loop).

## 📚 Next

- [About forger](../ABOUT.md) - why forger works the way it does.
- [Commands reference](reference/commands.md) - every command.
- [Configuration reference](reference/configuration.md) - every config field.
