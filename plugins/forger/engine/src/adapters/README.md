# adapters

The side effects the core receives instead of performing: running a shell
command, and spawning the agent under a deadline. Everything here touches the
world, and is tested against real processes.

## Files

- `exec.ts` - command runners over `execSync`: one that swallows a failure to
  empty output, one that keeps stdout, stderr and the exit code.
- `supervise.ts` - spawns a worker as its own process group and ends the whole
  group at the deadline.
- `claude.ts` - the headless `claude` invocation for one iteration.

## Entry point

`index.ts`. Only `cli/` wires these in.

## May import

The core (the port types in `ports/`).
