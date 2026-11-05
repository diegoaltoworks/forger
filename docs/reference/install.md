# Install

Install, update and onboard in detail. The short path is in
[`../getting-started.md`](../getting-started.md).

## Install and update

Add this repository as a marketplace once, then install. A local checkout works
as well as the GitHub repository, and installs alongside any other loop plugin:

```
claude plugin marketplace add <path-or-owner/repo>
claude plugin install forger@forger
```

Update on each machine, then restart Claude Code:

```
claude plugin marketplace update forger
claude plugin update forger@forger
```

Already-onboarded repos keep working with their files in `.claude/` (the legacy layout):
every command prints one warning naming `migrate`, which moves them to `.forger/`. An old config without a
`tracker` section gets the GitHub default on merge; set `tracker.kind` to
`local` or `none` in repos that should stay off GitHub Issues, and run
`gh label create ready-for-agent` in repos that opt in.

## Prerequisites

- [Bun](https://bun.sh) on `PATH` (the engine is a Bun program).
- The `claude` CLI on `PATH` (the engine spawns it per iteration).
- The `gh` CLI, authenticated, when `tracker.kind` is `github`.

## Onboard a repo

Run `/forger:setup`. It copies the templates into `.forger/` (never
overwriting), asks for the gates command and base branch, decides the tracker,
creates the `ready-for-agent` label, and gitignores the per-run state.

Then fill in `.forger/process.md` - the project's rules and **gotchas**. The
worker treats these as enforced. Run `/forger:plan` to generate the
first tickets, and `/forger:work` to start.

The copy is a tested command: `bun "$CLAUDE_PLUGIN_ROOT/bin/work.ts" setup --json
[--gates CMD] [--base-branch B] [--tracker KIND] [--flavour NAME] [--packs A,B] [--harness H]`. It installs the
chosen opinion packs (default `base`), records them in `.forger/forger.lock.json`, and writes `.forger/` files
only where they are absent, installs the default `process.md`, the ticket, PR,
work order, report, retro and rule templates and the hook policy
(`.forger/hooks.json`), adds the docs check to the gates, installs the harness
hook that refuses a worker's hand merge, base-branch or forced push, status
write and state edit, and gitignores the per-run state. Create the label with
`gh label create ready-for-agent`.

