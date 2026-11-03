# ports

The shapes the core is written against for the side effects it does not perform
itself: running a command, and spawning the agent for one iteration. `adapters/`
implements them and `cli/` hands the implementations in.

## Files

- `command.ts` - `CommandRunner`, `CapturingRunner`, `CommandResult`, and
  `capturing` to see one as the other. Pure.
- `ui.ts` - `AppServer` and `Screenshotter`, what `screenshot` is written against,
  and the error for an environment that cannot capture. Types only.
- `agent.ts` - `AgentRunner`, what a worker run is given and what it returns.
  Types only.

## Entry point

`index.ts`.

## May import

The core: `config` (the model role).
