# adapters

The side effects the core receives instead of performing: running a shell
command, and running the agent under a deadline. Everything here touches the
world, and is tested against real processes.

## Files

- `exec.ts` - command runners over `execSync`: one that swallows a failure to
  empty output, one that keeps stdout, stderr and the exit code.
- `supervise.ts` - spawns a worker as its own process group and ends the whole
  group at the deadline.
- `claude.ts` - the `AgentRunner` for the headless `claude` CLI, the one
  harness shipped today. A second harness is another file here implementing
  the same interface.

## Entry point

`index.ts`. Only `cli/` wires these in.

## May import

The core (the port types in `ports/`).
