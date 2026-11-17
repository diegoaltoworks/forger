# Install

Install, update and onboard in detail. The short path is in
[`../getting-started.md`](../getting-started.md).

## Install and update

Add the GitHub repository as a marketplace once, then install. The plugin
installs alongside any other loop plugin:

```
claude plugin marketplace add diegoaltoworks/forger
claude plugin install forger@forger
```

An installed copy changes only when it is updated, which is what a loop that does
real work needs: an engine loads its code from disk at each hook call, `verify`
and `merge`, so a copy that moves under a running loop leaves it part old code and
part new.

A local checkout is the source for a person developing forger. Add its path in
place of `diegoaltoworks/forger`. A repository whose loop does real work installs
from GitHub instead. Update the installed copy only when no engine that runs from
it is alive.

Update on each machine, then restart Claude Code:

```
claude plugin marketplace update forger
claude plugin update forger@forger
```

Then, in each repository that is set up, with no engine alive there, run `/forger:update` (`forger-update` in the other harnesses). It upgrades the install on a branch and lands it by pull request.

### 🧰 Without Claude Code

OpenCode, Codex and Copilot need no plugin. Clone the repository once and run
setup from the repository you want the loop to work on. The engine has no
runtime dependencies, so there is no install step.

```
git clone https://github.com/diegoaltoworks/forger ~/forger
bun ~/forger/plugins/forger/bin/work.ts setup --harness opencode
```

Use `codex` or `copilot` in place of `opencode`. Setup writes the packaged
commands where the harness reads them (see [Adapters](adapters.md)) and records
the harness in the config. To update, pull the clone and run the same setup
line again: it rewrites the commands that changed and keeps everything else.
In these harnesses a command is named `forger-<step>`, for example
`/forger-work` in OpenCode and Copilot and `$forger-work` in Codex.
A worker runs in a worktree made from the base branch, so these command files must be committed and not ignored by git: `setup` lists the ones git ignores or does not track, `check commands` fails on them, and `run` starts no worker until they are on the base branch.

Already-onboarded repos keep working with their files in `.claude/` (the legacy layout):
every command prints one warning naming `migrate`, which moves them to `.forger/`. An old config without a
`tracker` section gets the GitHub default on merge; set `tracker.kind` to
`local` or `none` in repos that should stay off GitHub Issues, and run
`gh label create ready-for-agent` in repos that opt in.

## Prerequisites

- [Bun](https://bun.sh) on `PATH` (the engine is a Bun program).
- One supported harness CLI on `PATH`: `claude`, `opencode`, `codex` or `copilot` (the engine spawns it per iteration).
- The `gh` CLI, authenticated, when `tracker.kind` is `github`.

## Onboard a repo

Run `/forger:setup`. It copies the templates into `.forger/` (never
overwriting), asks for the gates command and base branch, decides the tracker,
creates the `ready-for-agent` label, and gitignores the per-run state. When it writes the config it records the base branch it finds: `--base-branch` wins, then the default branch of the remote (`origin/HEAD`), then the current branch, then the template's. Only the local repository is read, the output says which of the four it used, and a config that exists keeps its base branch.

Then fill in `.forger/process.md` - the project's rules and **gotchas**. The
worker treats these as enforced. Run `/forger:plan` to generate the
first tickets, and `/forger:work` to start.

The copy is a tested command: `bun "$CLAUDE_PLUGIN_ROOT/bin/work.ts" setup --json
[--gates CMD] [--base-branch B] [--tracker KIND] [--jira-site URL --jira-project KEY] [--flavour NAME] [--packs A,B] [--harness H] [--starter NAME | --no-starter]`. In a repository with no source file it first copies the starter from `plugins/forger/starters/` (Bun and TypeScript by default), without overwriting, and uses the starter's gates and packs. It installs the
chosen opinion packs (default `base` and `structure`; the structure pack's baseline is recorded when it is installed, and `setup --upgrade` adds the default packs an install lacks), records them in `.forger/forger.lock.json`, and writes `.forger/` files
only where they are absent, installs the default `process.md`, the ticket, PR,
work order, report, retro and rule templates and the hook policy
(`.forger/hooks.json`), adds the docs check to the gates, installs the harness's
guard (a hook or plugin, in the mechanism that harness documents, see [Adapters](adapters.md)) that refuses a worker's hand merge, base-branch or forced push, status
write and state edit, and gitignores the per-run state. The hook line refuses a worker's call when the hook cannot run. `setup --upgrade` replaces the earlier hook line (the bare `work.ts hook` command) with it and reports the settings file as written; a project's own hook line is kept, and `check hooks` fails on it until it fails closed or a waiver covers it. Commit the changed settings file to the base branch: until then `check hooks` fails and `run` starts no worker. Create the label with
`gh label create ready-for-agent`.

For Jira, run `setup --tracker jira --jira-site URL --jira-project KEY`. It writes `tracker.kind` and `tracker.jira` into the config, creates no label and makes the status issue when `JIRA_EMAIL` and `JIRA_API_TOKEN` are set. Without them it still writes the config, says which variable is missing and that the checks have not run, and exits 0; `check tracker` reports the rest once they are set. A repository that is set up changes its tracker kind by editing `tracker` in `.forger/workloop.config.json` (a kept config is never rewritten by `setup`); `/forger:update` carries the change through, since it keeps the config as it is. See [the tracker](tracker.md).

