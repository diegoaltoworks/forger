# adapters

The side effects the core receives instead of performing: running a shell
command, running the agent under a deadline, and serving and photographing an app. Everything here touches the
world, and is tested against real processes.

## Files

- `exec.ts` - command runners over `execSync`. One turns a failure into empty
  output. One keeps stdout, stderr and the exit code.
- `supervise.ts` - spawns a worker as its own process group and ends the whole
  group at the deadline.
- `host-sandbox.ts` - the `host` `Sandbox`: a git worktree, the worker as its own process group, the timeout.
- `docker-plan.ts` - the pure half of the `docker` sandbox: the image choice, the `docker run` arguments and the reading of `docker info`.
- `docker-sandbox.ts` - the `docker` `Sandbox`: one container per worker that clones origin, with no host mounts.
- `credentials.ts` - the pure half of credentials: the variable per harness and kind, the app JWT and `redact`.
- `github-token.ts` - the run's one GitHub token: a variable, or one minted for the repository through an injected `GithubApi`.
- `redacting-sandbox.ts` - wraps any `Sandbox` so credential values are removed from the output the engine records.
- `sandboxes.ts` - the sandboxes by id, and `sandboxFor`, which the config's `sandbox` key picks.
- `svg-raster.ts` - the brand `Rasteriser` over resvg; text is already outlines, so no font is loaded.
- `static-server.ts` - the `AppServer` port over one folder served in-process, for wireframes
- `app-server.ts` - the `AppServer` port over a shell command in its own process
  group, ready when the url answers.

- `playwright.ts` - the `Screenshotter`, `Recorder` and `AccessibilityAuditor`
  ports over the project's own Playwright. It resolves Playwright from the
  project. Forger never depends on it.
- `claude.ts`, `opencode.ts`, `codex.ts`, `copilot.ts` - the shipped `Harness` adapters. A harness is
  another file here implementing the same interface; its spawn arguments and
  install paths are pure and table-tested.
- `skill-package.ts` - repackages a command as a repository skill, for the harnesses that load skills.
- `slcr.ts` - the `SpecProvider` over the `slcr` binary. It runs `check --format json`,
  `query` and `slice` through the command port. The base side is the base
  branch exported to a scratch folder.
- `slcr-report.ts` - the pure parsing of that output into the normalized report; a changed shape is
  a `SpecOutputError` naming the field. Tested on recorded output in `fixtures/slcr/`.
- `harnesses.ts` - the shipped harnesses by id, and `agentFor`, the
  `AgentRunner` any of them yields over `supervise.ts`.
- `local-state-store.ts` - the `StateStore` over files beside the engine, the behaviour before the state branch.
- `memory-state-store.ts` - the in-memory `StateStore` the loop's tests use.
- `git-state-store.ts` - the `StateStore` over the state branch. Reads and
  writes use git plumbing and a private ref, so HEAD and the working tree never
  move. A write is a non-forced push. It retries a bounded number of times on
  a fresh read. A lease that cannot be written is lost.

## Entry point

`index.ts`. Only `cli/` wires these in.

## May import

The core (the port types in `ports/`).
