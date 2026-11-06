# Workers run in a sandbox behind an adapter

Status: Proposed

The owner asked for the sandbox seam, and that it "support both api key and subscription".

## Context

A worker runs on the host, in a git worktree, as the user who started the engine. It can read anything that user can read: other repositories, credentials, the whole home folder. It shares the host's `/tmp`, memory and ports with every other process. The hooks (ADR 0018) refuse the commands they recognise; they do not isolate, and a shell can always do something a hook cannot read. The worker's tools come from whatever the host has installed, so a run cannot be reproduced on another machine. Loop state already does not depend on one machine (ADR 0015); the place a worker runs should not either.

## Decision

### The seam

A `Sandbox` adapter sits beside `Harness` in `adapters/`. It owns how a worker's process is started, given its repository and credentials, how it is limited, and how it is ended. The `Harness` still decides what command runs; the `Sandbox` decides where and under what limits. The engine and the verifier start workers only through it. The config key `sandbox` picks the backend.

| Backend | What it is |
|---|---|
| `host` | Today's behaviour: a worktree, a process group, the timeout. The default. |
| `docker` | One container per run, from an image, with limits. |
| `remote` | A host outside this machine, for the CI-native plan. Later. |

### The image

The image comes from the repository's `.devcontainer/` when it has one, following the Development Container specification (https://containers.dev/implementors/spec/). Otherwise it is a forger base image for the repository's stack. Either way the harness CLI and a pinned forger version are in the image, so two machines run the same tools.

### The repository inside

The container clones from origin at the base branch and pushes its own branch. Nothing from the host is mounted except named caches (package caches, for example), which hold no credentials and no repository. A worker therefore cannot read the host's other repositories, and the host's checkout is not the worker's.

### Credentials

Credentials reach the container only as environment variables passed at start. They are never written into the image, a layer or a log. The engine redacts them from any output it records.

- **GitHub.** One token per run, scoped to the one repository: a GitHub App installation token limited to that repository (https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app), or a fine-grained personal access token limited to it (https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens). The installation token is preferred because it expires on its own.
- **The model.** Each harness takes either kind: an API key, or a subscription token made for headless use. The adapters reference names, per harness, the variable and how the subscription token is made. A subscription has its own usage limits, so a run on one is bounded by the plan, not by the budget cap in the config (see `docs/reference/adapters.md`, run limits).

The variable and the way to make the subscription token, per harness, with a link to each harness's own documentation, are in the credentials table of `docs/reference/adapters.md`.

A harness whose documentation names no headless subscription route is listed as API key only, and the spike for it records that. The ADR does not guess a variable the vendor has not published.

### Limits

The container sets memory, CPUs, a process count and a sized `/tmp` (https://docs.docker.com/engine/containers/resource_constraints/). The run timeout and its grace period, which the engine already enforces, end the container: a stop signal first, a kill after the grace period, then removal of the container.

### The engine

The engine itself runs as a container with a restart policy (https://docs.docker.com/engine/containers/start-containers-automatically/), so no terminal session owns it. It reads and writes loop state through the state branch and the tracker (ADR 0015), so a restarted engine continues.

### Rootless

Docker rootless mode (https://docs.docker.com/engine/security/rootless/) is supported and recommended: a container escape then lands as an unprivileged user, not as root on the host. The `docker` backend must work in it, and `check` reports whether the daemon is rootless.

## Not chosen

- **A namespace sandbox such as bubblewrap** (https://github.com/containers/bubblewrap). It is Linux only and starts a process on the same machine, so it gives neither a reproducible image nor a path to a remote host. It remains a possible extra `Sandbox` backend if someone needs it.
- **An external sandbox service as the first backend.** It adds an account, a network dependency and a cost before the seam is proven. The `remote` backend can adopt one later behind the same interface.

## Consequences

- Isolation becomes a property of the backend, not of the hooks. The hooks stay as the first line.
- `host` stays the default, so nothing changes until a project opts in.
- A run's tools are as reproducible as its image.
- Credentials have one path, environment variables, so one redaction rule covers them.

## Child tickets, in order

1. The `Sandbox` seam with a `host` backend that runs workers as today. The engine and the verifier start workers only through it.
2. The `docker` backend: image from `.devcontainer/` or the base image, clone and push inside, limits, timeout and removal.
3. Credentials: one repository-scoped GitHub token per run, the per-harness model credential for an API key or a subscription, and redaction.
4. Forger base images per stack, with the harness CLI and a pinned forger version.
5. The engine as a container with a restart policy, and the rootless check.
6. The `remote` backend, with the CI-native plan.
