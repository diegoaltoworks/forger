# adapters

The side effects the core receives instead of performing: running a shell
command, running the agent under a deadline, and serving and photographing an app. Everything here touches the
world, and is tested against real processes.

## Files

- `exec.ts` - command runners over `execSync`: one that swallows a failure to
  empty output, one that keeps stdout, stderr and the exit code.
- `supervise.ts` - spawns a worker as its own process group and ends the whole
  group at the deadline.
- `svg-raster.ts` - the brand `Rasteriser` over resvg; text is already outlines, so no font is loaded.
- `static-server.ts` - the `AppServer` port over one folder served in-process, for wireframes
- `app-server.ts` - the `AppServer` port over a shell command in its own process
  group, ready when the url answers.
- `playwright.ts` - the `Screenshotter` and `AccessibilityAuditor` ports over the project's own Playwright,
  resolved from the project, never a dependency of forger.
- `claude.ts`, `opencode.ts` - the shipped `Harness` adapters. A harness is
  another file here implementing the same interface; its spawn arguments and
  install paths are pure and table-tested.
- `harnesses.ts` - the shipped harnesses by id, and `agentFor`, the
  `AgentRunner` any of them yields over `supervise.ts`.

## Entry point

`index.ts`. Only `cli/` wires these in.

## May import

The core (the port types in `ports/`).
