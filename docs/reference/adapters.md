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

- **Sandbox.** Where a worker's process runs, and with what limits, sits behind a `Sandbox` seam beside
  `Harness`, with `host` and `docker` backends shipped and a later `remote` backend proposed. See
  [ADR 0019](../adr/0019-workers-run-in-a-sandbox-behind-an-adapter.md) and the [Sandbox](#sandbox) section.

## Credentials in a sandbox

Set in the environment that starts the run ([ADR 0019](../adr/0019-workers-run-in-a-sandbox-behind-an-adapter.md)). The config's `credentials` section picks what a run gets (see [configuration](configuration.md)); `setup --credential api_key|subscription` records the kind for the harness and says how to make a subscription token for headless use.

- **GitHub.** One token per run, scoped to the one repository. `source: env` reads it from a variable. `source: app` mints a GitHub App installation token per run for that repository alone, from the app id and private key in the environment, so it expires on its own. The container receives it as `GH_TOKEN`.
- **The model.** The kind the config names for the harness decides which variable the container receives; the table below is what each adapter maps. A kind the CLI documents no variable for is refused before the container starts, naming the kind that works.
- **Redaction.** The container receives variables by name, so no secret appears in a command line, an image or a layer. Every worker's output is scanned and the values of these variables, and of a minted token, are replaced before the engine records it, so the iteration log, the events file and a verdict never hold one.

| Harness | API key variable | Subscription token | Source |
|---|---|---|---|
| `claude` | `ANTHROPIC_API_KEY` | Run `claude setup-token` once on a machine with a browser; it prints a long-lived token. Pass it as `CLAUDE_CODE_OAUTH_TOKEN`. | https://docs.claude.com/en/docs/claude-code/github-actions and https://docs.claude.com/en/docs/claude-code/iam |
| `codex` | `CODEX_API_KEY` for `codex exec`, or `OPENAI_API_KEY` | None as a variable: signing in with ChatGPT caches an `auth.json` file, which is a file and not a variable, so a sandbox takes the API key only. | https://developers.openai.com/codex/auth |
| `copilot` | none: Copilot is billed to the subscription | A fine-grained personal access token with the Copilot Requests permission, passed as `COPILOT_GITHUB_TOKEN`. | https://docs.github.com/en/copilot/how-tos/copilot-cli |
| `opencode` | the provider's own variable; the adapter passes `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` | None as a variable: `opencode auth login` caches an `auth.json` file, so a sandbox takes the provider's API key only. | https://opencode.ai/docs/providers/ |

## Sandbox

Where a worker runs and under what limits is the `Sandbox` seam ([ADR 0019](../adr/0019-workers-run-in-a-sandbox-behind-an-adapter.md)). The `Harness` decides what command runs; the sandbox decides where. The engine and the verifier start workers only through it. Set `sandbox` in the config to pick the backend (see [configuration](configuration.md)).

A sandbox does four things:

- **prepare** a workspace for a ticket and return its path, or say why it could not;
- **start** the harness command in a workspace with its environment, input and limits (the timeout, its grace period and the spend limit), and return the worker's output and exit;
- **end** a running worker and everything it started;
- **clean up** the workspace, and the ticket's branch when asked.

| Backend | What it is |
|---|---|
| `host` | The default. A git worktree, the worker as its own process group on this machine, and the timeout. |
| `docker` | One container per worker. See below. |

The `remote` backend is proposed in the ADR and is not shipped.

### The docker backend

Set `sandbox` to `docker`, or run `setup --sandbox docker`, which writes the config and checks that the Docker API answers. When it does not, setup says what to do: start the daemon, join the `docker` group, or on a rootless install start the user service and set `DOCKER_HOST` to its socket.

- **Image.** Yours: forger ships none and never runs `docker build` on an image of its own. The repository's `.devcontainer/` wins when it names an `image` or a `build` with a Dockerfile (or holds a `Dockerfile`); else the image named by `sandbox_image` in the config. With neither, `run`, `verify` and `setup --sandbox docker` refuse and say so. Samples to copy live under `examples/sandbox/`.
- **The image contract.** The image provides `git`, `bun`, the configured harness CLI on the `PATH`, and a non-root default user (a harness refuses to run unattended as root). A repository whose workers produce UI evidence also needs a headless browser. `check sandbox` starts the image with a probe per item and prints one line each: `pass`, or what is missing and how to add it. It exits 0 only when every item passes, and under the `host` sandbox prints that there is nothing to check.
- **Forger is copied in.** Each container is created, the engine's own plugin directory is copied into it (`docker create`, `docker cp`, `docker start`) and `FORGER_PLUGIN_ROOT` points at the copy, so the image carries no forger and its version always matches the engine's.
- **Detach.** `run --detach` under the `docker` sandbox starts the engine in a container of the image named by `sandbox_engine_image`: the contract plus the `docker` CLI. Without it the start is refused, naming the field. The plugin is copied in the same way.
- **Run.** One container per worker, removed when the worker ends or is ended. It clones the repository from origin at the base branch, checks out the ticket's branch (from origin when it exists there) and runs the harness command. An ssh remote is cloned over https, so a `GH_TOKEN` or `GITHUB_TOKEN` is what lets the container fetch a private repository and push.
- **Mounts.** None from the host: not the working tree, the home folder or `/tmp`. The only mounts are named volumes for the bun, uv and npm caches, shared between runs of one repository.
- **The verifier.** `verify` starts its run through the same seam and backend, in its own container with the same limits. The container checks out the pull request's head, and its GitHub token can only read: a GitHub App token is minted with read permissions, and with `source` `env` the token is read from `read_variable`, never from the write token. With none set the container has no token, which is enough for a public repository. The UI checks (screenshots, recordings) run in that container, and the image must carry a headless browser for them.
- **Outcomes.** The engine reads them from the tracker and git, as with `host`, and never opens a file in the container. The host keeps a worktree for the ticket only as its own anchor; the container never sees it, so the engine's early check for a branch that conflicts with the base does not see the container's commits, and a conflict surfaces at the pull request instead.

## Run limits

The engine enforces a run's limits itself, whatever the harness. Every run has the wall-clock timeout
(`limits.timeoutMinutes`): the worker's process group is ended when it passes. The spend limit is the ticket's
budget from the config, applied the same way in every harness and never raised by the engine. A harness that
reports usage in its output implements `spentUsd(output)` on the `Harness` seam; the engine reads it as the
output arrives and ends the worker's process group once the reported spend passes the budget, logging that it did.
Claude Code also gets its own `--max-budget-usd` cap.

A run with no spend limit runs under the timeout alone, and says so: the engine logs at the start of the run
that the harness reports no usage for the model, and `status --json` shows `runner.spendLimit` as `none`
(`harness` when the harness caps the budget itself, `engine` when the engine reads the spend, `partial`
when only some of the models the config can pick are covered).

## Spend limit by harness

The headless mode of OpenCode and Codex is started with its JSON event stream so usage can be read. The worker's
own words are decoded from the stream, so its completion signal is still read.

| Harness | Spend limit | Source |
|---|---|---|
| `claude` | Yes, the harness's own `--max-budget-usd` cap | Claude Code's CLI reference |
| `opencode` | Yes, from the cost in each `step_finish` event of `run --format json` | OpenCode CLI documentation and its SDK's `StepFinishPart` |
| `codex` | Only for a model with a price in `model_prices`: `exec --json` reports token counts and no cost | Codex non-interactive mode documentation, `turn.completed` usage |
| `copilot` | No: `-p` output documents no cost or token count | Copilot CLI programmatic reference |

A harness that reports tokens only prices them with `model_prices` in the config, keyed by the model id the role
maps to (see [configuration](configuration.md)). With no price for a model its run has no spend limit.

## Guards

Forger's boundaries for a worker (no hand merge, no commit status, no push to the base branch, no force push
without lease, no edit of the engine's state, and the read-only rule for the loop's checkout) are refused by
`work.ts hook` before the call runs. `setup` installs that hook where each harness documents it
([ADR 0018](../adr/0018-every-harness-refuses-the-same-calls-in-its-own-mechanism.md) lists the sources):

| Harness | Guard | Proven |
|---|---|---|
| `claude` | `PreToolUse` hook in `.claude/settings.json` | yes |
| `opencode` | plugin `.opencode/plugins/forger-guard.js` | not yet |
| `codex` | `PreToolUse` hook in `.codex/hooks.json`; trust the project and review the hook with `/hooks` | not yet |
| `copilot` | `preToolUse` hook in `.github/hooks/forger.json` | not yet |

A harness with no way to refuse a call is unguarded. `run` refuses to start with it unless the config sets
`allow_unguarded: true`. No shipped harness is unguarded.

Proven means a real run in that harness has merged a ticket. A harness moves to `yes` only in the PR that records its proving run.
