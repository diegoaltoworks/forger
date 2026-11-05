# Every harness refuses the same calls, in its own mechanism

Status: Accepted

The owner asked that forger work in any harness, "copilot, opencode, etc...", and that this be a priority.

## Context

The worker's hard boundaries (no hand merge, no commit status written by the worker, no push to the base branch, no force push without lease, no edit of the engine's state, and no state-changing git in the loop's checkout while an engine is alive) are enforced by a hook that refuses the call before it runs (ADR 0002). The decision is one tested command, `work.ts hook`. Only the way a harness runs it differs. Each mechanism below comes from the harness's own documentation.

## Decision

Setup installs the same hook command in the mechanism each harness documents. The hook reads the harness's payload shape and exits 2 to refuse, which every mechanism below treats as a denial or turns into one.

| Harness | Mechanism | File setup writes | Source |
|---|---|---|---|
| `claude` | `PreToolUse` command hook | `.claude/settings.json` | https://docs.claude.com/en/docs/claude-code/hooks |
| `opencode` | project plugin with a `tool.execute.before` hook that throws | `.opencode/plugins/forger-guard.js` | https://opencode.ai/docs/plugins/ |
| `codex` | `PreToolUse` command hook, trusted with `/hooks` | `.codex/hooks.json` | https://learn.chatgpt.com/docs/hooks |
| `copilot` | repository `preToolUse` command hook | `.github/hooks/forger.json` | https://docs.github.com/en/copilot/reference/hooks-configuration |

Codex runs a project hook only once the project's `.codex/` layer is trusted and the hook is reviewed, and its documentation calls tool hooks a guardrail, not a complete boundary. The same holds for the others: a shell can always do something the hook cannot read. The hook narrows what a worker can do by mistake; the independent verifier (ADR 0010) and the branch protection are the backstop.

A harness with no way to refuse a call is marked unguarded in `docs/reference/adapters.md`, and `run` refuses to start with it unless the config sets `allow_unguarded: true`.

## Consequences

- A new harness adapter names its mechanism, or `hooks: null` and an unguarded mark.
- `check hooks` reads the settings of the configured harness, whichever it is.
