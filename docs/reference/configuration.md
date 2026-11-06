# Configuration

Every field of `.forger/workloop.config.json`.

## Configuration

`.forger/workloop.config.json` (any field omitted falls back to the default):

| Field | Meaning |
|---|---|
| `repo` | If set, only tickets with this `repo` (or none) are worked here. `null` = no filter. |
| `harness` | The harness that runs the worker: `claude` (default), `opencode`, `codex` or `copilot`. |
| `sandbox` | Where workers run: `host` (default), a git worktree on this machine, or `docker`, one container per worker. See [adapters](adapters.md). |
| `allow_unguarded` | `true` lets `run` start with a harness that cannot refuse a tool call. Default `false`. |
| `worker_command` | Slash command the engine invokes per iteration. Default `forger:auto-ticket`. |
| `gates` | The quality-gate command; surfaced to the worker. |
| `base_branch` | Branch an iteration must land on. Merge verification checks HEAD against it. |
| `models` | Role -> model id the agent adapter is given. Default `fast`, `standard` and `deep`. A project remaps a role here, and tickets, logs and docs keep naming the role. |
| `model_by_priority` | Role + USD budget per priority (`P0`, `default`, and any others). A tier naming something that is not a role is taken as a literal model id, so an older config keeps working. |
| `model_prices` | Model id -> `{input, output, cached_input}` in USD per million tokens (`cached_input` defaults to `input`). Lets the engine enforce the budget in a harness that reports tokens and not cost; a model with no price runs with no spend limit there (see [adapters](adapters.md)). Default none. |
| `effort_multiplier` | Budget multiplier by ticket `effort` (`small`/`medium`/`large`/...). |
| `limits` | `timeoutMinutes`, `killGraceSeconds` (SIGTERM to SIGKILL on timeout), `maxConsecutiveFailures`, `pauseBetweenIterations`, `pauseAfterFailure`, `maxStallIterations`. |
| `paths` | Where the backlog, state, log, output dir, HALT file, engine lock, terminal-event file, verdicts directory and `process.md` live. The verdicts stay local, not committed; the dirty-tree check skips them. Default under `.forger/`. |
| `local_only` | Paths that stay modified in a checkout without being the worker's doing (local settings, a work order). The dirty-tree check skips them and the engine's own files (`paths`); a directory covers what is under it. Default none. |
| `model_names` | Model and vendor names `check docs` flags in prose, as whole words, case-insensitively. Default a list of common ones. |
| `flavour` | `"<name>"` or `"<name>@<version>"`: the flavour that picks a skill per slot (see [skill slots](skill-slots.md)). Default `default`: every slot uses its built-in step. |
| `skills` | Skill slot -> installed skill name, or `{ "file": "<path to SKILL.md>" }`. Wins over the flavour for the slots it names. Default none. |
| `state` | `{ home, branch }`. `home` is `local` (default: state and events sit in files beside the engine) or `branch` (they live on `branch` of the remote, default `forger-state`, and the engine holds a lease while it runs; ADR 0015). Move existing state with `migrate --state`; roll back by setting `home` back to `local`, nothing is deleted. Other values are refused when the config loads. |
| `tracker` | `{ kind, label, ignore }`. `kind` is `github` (default: issues are the backlog), `local`, or `none` (both read `backlog.json`). `label` is the intake label, default `ready-for-agent`. `ignore` lists labels whose issues are not work, a trailing `*` matching a prefix (`["wayfinder:*"]`); default none. |

