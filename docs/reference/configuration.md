# Configuration

Every field of `.forger/workloop.config.json`.

## Configuration

`.forger/workloop.config.json` (any field omitted falls back to the default):

| Field | Meaning |
|---|---|
| `repo` | If set, only tickets with this `repo` (or none) are worked here. `null` = no filter. |
| `harness` | The harness that runs the worker: `claude` (default), `opencode`, `codex` or `copilot`. |
| `sandbox` | Where workers run: `host` (default), a git worktree on this machine, or `docker`, one container per worker. See [adapters](adapters.md). |
| `sandbox_image` | The image of the `docker` sandbox when the repository's `.devcontainer/` names none. Forger ships no image; yours must meet the image contract, which `check sandbox` tests. Default none, and `docker` without any image refuses. See [adapters](adapters.md#the-docker-backend). |
| `sandbox_engine_image` | The image `run --detach` starts the engine in under the `docker` sandbox: the image contract plus the `docker` CLI. Default none, and `run --detach` under `docker` refuses without it. |
| `sandbox_limits` | `{ memory, cpus, pids, tmp }`, applied to each container of the `docker` sandbox: `memory` (swap is capped with it) and `tmp` (the size of `/tmp`) take a docker size such as `4g`, `cpus` a number of CPUs, `pids` the most processes. A run past its deadline has its container stopped and then removed, and the iteration log records both. A run the kernel killed for memory is an infrastructure error naming the limit, not a worker failure. Defaults are set in the engine's default config. |
| `credentials` | `{ github, model }`. `github` is `{ source, variable, read_variable, app_id_variable, app_key_variable }`: `source` `env` (default) reads the run's one GitHub token from `variable` (default `GH_TOKEN`) and the verifier's read-only token from `read_variable` (default `GH_READ_TOKEN`); `app` mints a GitHub App installation token per run, limited to the one repository, from the app id and private key in the two named variables. `model` maps a harness id to `api_key` or `subscription`, and the harness's adapter maps the kind to the variable its CLI reads (see [adapters](adapters.md#credentials-in-a-sandbox)); a harness with no entry receives every variable it can read. Credentials reach a sandbox only as environment variables, and their values are redacted from the logs. Default `env` and no `model` entries. |
| `allow_unguarded` | `true` lets `run` start with a harness that cannot refuse a tool call. Default `false`. |
| `worker_command` | Slash command the engine invokes per iteration. Default `forger:auto-ticket`. |
| `gates` | The quality-gate command; surfaced to the worker. |
| `base_branch` | Branch an iteration must land on. Merge verification checks HEAD against it. |
| `models` | Role -> model id the agent adapter is given. Default `fast`, `standard` and `deep`. A project remaps a role here, and tickets, logs and docs keep naming the role. |
| `model_by_priority` | Role + USD budget per priority (`P0`, `default`, and any others). A tier naming something that is not a role is taken as a literal model id, so an older config keeps working. |
| `model_prices` | Model id -> `{input, output, cached_input}` in USD per million tokens (`cached_input` defaults to `input`). Lets the engine enforce the budget in a harness that reports tokens and not cost; a model with no price runs with no spend limit there (see [adapters](adapters.md)). Default none. |
| `effort_multiplier` | Budget multiplier by ticket `effort` (`small`/`medium`/`large`/...). |
| `limits` | `timeoutMinutes`, `killGraceSeconds` (SIGTERM to SIGKILL on timeout), `maxConsecutiveFailures`, `pauseBetweenIterations`, `pauseAfterFailure`, `maxStallIterations`, `maxConsecutiveDeclines` (declined picks in a row that halt the loop), `maxSetAside` (tickets set aside after a worker's stop, in a row with no merge between them, that halt the loop), `engineChangedWaitSeconds` (how long `verify` and `merge` wait for the engine's uncommitted changes to go before they refuse). |
| `paths` | Where the backlog, state, log, output dir, HALT file, engine lock, terminal-event file, verdicts directory, checks file and `process.md` live. `paths.checks` (default `.forger/checks.jsonl`) takes one JSON line per opinion per `check` run inside a worker, so a reader can measure what a rule costs; it is written under the loop's root. The verdicts, the checks file and the worktrees folder stay local, not committed; the dirty-tree check skips them. Default under `.forger/`. |
| `guards` | Path globs of the files that hold guarantees (thresholds, budgets, baselines, layout floors). `facts --guards` lists them. Unset, it holds the testing pack's coverage baseline the ui pack's approved-baselines manifest and the structure pack's baseline, for the packs that are installed. |
| `local_only` | Paths that stay modified in a checkout without being the worker's doing (local settings, a work order). The dirty-tree check skips them and the engine's own files (`paths`); a directory covers what is under it. Default none. |
| `model_names` | Model and vendor names `check docs` flags in prose, as whole words, case-insensitively. Default a list of common ones. |
| `flavour` | `"<name>"` or `"<name>@<version>"`: the flavour that picks a skill per slot (see [skill slots](skill-slots.md)). Default `default`: every slot uses its built-in step. |
| `skills` | Skill slot -> installed skill name, or `{ "file": "<path to SKILL.md>" }`. Wins over the flavour for the slots it names. Default none. |
| `state` | `{ home, branch }`. `home` is `local` (default: state and events sit in files beside the engine) or `branch` (they live on `branch` of the remote, default `forger-state`, and the engine holds a lease while it runs; ADR 0015). Move existing state with `migrate --state`; roll back by setting `home` back to `local`, nothing is deleted. Other values are refused when the config loads. |
| `verify.setup` | A string: `verify.setup` is the shell command run in the verifier's copy before the model starts, to install dependencies. Unset, the install step of `gates` runs; when the gates name none, the frozen install for the lockfile at the root of the copy runs (`bun.lock` or `bun.lockb`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `uv.lock`, `Cargo.lock`). An empty string means no setup at all. The verdict record names the command that ran and its source (`configured`, `gates` or `lockfile`). When none of the three gives a command no setup runs: the verifier's prompt says so, `verify` warns on stderr, and a command that fails for a missing dependency is `cannot_tell` with `missing: infra`. Default unset. |
| `tracker` | `{ kind, label, ignore }`. `kind` is `github` (default: issues are the backlog), `local`, or `none` (both read `backlog.json`). `label` is the intake label, default `ready-for-agent`. `ignore` lists labels whose issues are not work, a trailing `*` matching a prefix (`["wayfinder:*"]`); default none. |


## Credentials

```json
{
  "credentials": {
    "github": {"source": "app"},
    "model": {"claude": "subscription"}
  }
}
```

The kind for a harness is `api_key` or `subscription`; `setup --credential` writes it.
A subscription run is bounded by the plan's own usage limits, not by the budget cap.
