# Adapters

The one place that names the harnesses and models forger runs with.

## Adapters

Forger's decisions live in tools, so the model and the harness are adapters (see
principle 0a in [`docs/01-principles.md`](../01-principles.md)). Today
there is one model mapping and several harnesses, named here and nowhere else in the prose:

- **Agent adapter.** The engine spawns workers through the `AgentRunner`
  interface, built from a `Harness`. The default harness runs Claude Code's headless `claude` CLI, mapping
  the role a ticket is given (`fast`, `standard`, `deep`) to the model id set
  under `models` in the config.
- **Harness.** What differs between agent tools sits behind the `Harness` seam: how the worker is spawned
  headless, where its commands are installed, and the variable that holds the plugin root. Set `harness`
  in the config (`claude`, the default, `opencode`, `codex` or `copilot`). `setup --harness <id>` writes the packaged
  commands: OpenCode reads them from `.opencode/commands/`; Codex and Copilot read repository skills, so
  they go to `.agents/skills/` and `.github/skills/`, and the worker is started by naming its skill. The steps exist once, in `commands/`; an adapter repackages them
  (frontmatter, plugin root) and never copies their text per harness. OpenCode takes a model as
  `provider/model`, so map the roles under `models` to such ids.

## Run limits

The engine enforces a run's limits itself, whatever the harness. Every run has the wall-clock timeout
(`limits.timeoutMinutes`): the worker's process group is ended when it passes. The spend limit is the ticket's
budget from the config, applied the same way in every harness and never raised by the engine. A harness that
reports usage in its output implements `spentUsd(output)` on the `Harness` seam; the engine reads it as the
output arrives and ends the worker's process group once the reported spend passes the budget, logging that it did.
Claude Code also gets its own `--max-budget-usd` cap.

A harness that reports no usage (`spentUsd` absent) runs under the timeout alone. OpenCode, Codex and Copilot
are in that case today: their headless output states no spend, so the budget cannot be enforced for them.

## Guards

Forger's boundaries for a worker (no hand merge, no commit status, no push to the base branch, no force push
without lease, no edit of the engine's state, and the read-only rule for the loop's checkout) are refused by
`work.ts hook` before the call runs. `setup` installs that hook where each harness documents it
([ADR 0018](../adr/0018-every-harness-refuses-the-same-calls-in-its-own-mechanism.md) lists the sources):

| Harness | Guard |
|---|---|
| `claude` | `PreToolUse` hook in `.claude/settings.json` |
| `opencode` | plugin `.opencode/plugins/forger-guard.js` |
| `codex` | `PreToolUse` hook in `.codex/hooks.json`; trust the project and review the hook with `/hooks` |
| `copilot` | `preToolUse` hook in `.github/hooks/forger.json` |

A harness with no way to refuse a call is unguarded. `run` refuses to start with it unless the config sets
`allow_unguarded: true`. No shipped harness is unguarded.
