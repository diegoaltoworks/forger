# Sandbox samples

These are starting points to copy. Forger publishes no image: your repository provides it, and forger tests it.

## What is here

| Folder | Use it for |
|---|---|
| `devcontainer/` | The recommended start. One `.devcontainer/` serves your editor and forger. |
| `node/Dockerfile` | A worker image with bun, git, `gh`, Node and a headless Chromium. |
| `python/Dockerfile` | The same, with Python and `uv`. |
| `engine/Dockerfile` | An image for `sandbox_engine_image`: a worker image plus the `docker` CLI. |

The harness package is a build argument, `HARNESS_PACKAGE`. It defaults to the npm package of the default harness. Pass another package to use another harness.

None of the samples installs forger. The engine copies its own plugin into each container.

## The contract

An image must provide:

- `git`
- `bun`
- the harness CLI on the `PATH`
- a non-root default user

Add a headless browser if your workers produce UI evidence. `check sandbox` tests each item and prints one line for it.

## Build a sample

```sh
docker build -t my-worker -f examples/sandbox/node/Dockerfile examples/sandbox/node
docker build -t my-worker --build-arg HARNESS_PACKAGE=<npm-package> -f examples/sandbox/node/Dockerfile examples/sandbox/node
```

## Use the image

Copy the sample into your repository. For the devcontainer, copy the `.devcontainer/` folder to the root of your repository. For a Dockerfile, build it and set `sandbox_image` in `.forger/workloop.config.json`:

```json
{"sandbox": "docker", "sandbox_image": "my-worker"}
```

Then test it:

```sh
bun plugins/forger/bin/work.ts check sandbox
```

The full walk-through is in [Run sandboxed](../../docs/run-sandboxed.md).
