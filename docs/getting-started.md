# Getting started

This page takes you from nothing to a running loop, one command per step. Each
step says what the command prints, so you know it worked. The detail behind each
step is in [Install reference](reference/install.md).

## 📋 1. Check the prerequisites

You need [Bun](https://bun.sh), the `claude` CLI and, for a GitHub tracker, an
authenticated `gh`.

```
bun --version
claude --version
gh auth status
```

Each prints a version or `Logged in`. A `command not found` names the tool to
install first.

## 📦 2. Install the plugin

Add the forger repository as a marketplace once, then install the plugin. A
local checkout works as well as `owner/repo` on GitHub.

```
claude plugin marketplace add <path-or-owner/repo>
claude plugin install forger@forger
```

The second command confirms the install. Restart the harness, then type
`/forger` in a session: the forger commands appear in the list. To update
later, see [Install reference](reference/install.md#install-and-update).

## 🛠️ 3. Set up the repository

Open a session at the root of the repository you want the loop to work on and
run:

```
/forger:setup
```

It asks for the gates command, the base branch and the tracker, and offers
skill flavours and opinion packs. It then prints every file under `.forger/`
as `written` or `kept`, and the tracker it chose and why. It never overwrites
a file, so a second run prints only `kept`.

With a GitHub tracker it also creates the intake label. To create it by hand:

```
gh label create ready-for-agent
```

Then fill in `.forger/process.md`: what the repository is and its gotchas. The
worker treats the gotchas as rules.

## 📝 4. Plan the first tickets

```
/forger:plan
```

The planner reads the repository, asks you numbered questions, each with a
recommendation, and then writes a plan doc and the tickets. On GitHub each
ticket is an issue with the `ready-for-agent` label. It ends with the goal and
the tickets it created, in build order.

## 🚀 5. Start the loop

```
/forger:work
```

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
authentication error. `/forger:work` and `status` print the reason. Fix the
cause first: look for a pushed branch with no merged pull request. Then clear
the halt and start again:

```
bun <forger>/bin/work.ts resume
/forger:work
```

`resume` clears the halt and the failure counters.

## 📚 Next

- [About forger](../ABOUT.md) - why forger works the way it does.
- [Commands reference](reference/commands.md) - every command.
- [Configuration reference](reference/configuration.md) - every config field.
