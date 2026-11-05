# ports

The shapes the core uses for side effects it does not perform itself, such as
running a command or spawning the agent. The folder `adapters/` implements
them, and the folder `cli/` hands the implementations in.

## Files

- `command.ts` - `CommandRunner`, `CapturingRunner`, `CommandResult`, and
  `capturing` to see one as the other. Pure.
- `ui.ts` - `AppServer`, `Screenshotter`, `Recorder`, `GifEncoder` and
  `AccessibilityAuditor`. `screenshot` and `check a11y` are written against
  them. Also the error for an environment that cannot capture. Types only.
- `spec.ts` - `SpecProvider` and the normalized requirement report `check spec`
  decides over, and `SpecOutputError`. Types only.
- `agent.ts` - `AgentRunner`, what a worker run is given and what it returns.
  Types only.
- `harness.ts` - `Harness`, what differs between agent tools: the headless spawn,
  where commands are installed, the plugin-root variable. Types only.
- `state-store.ts` - `StateStore`, where the state record, the event log and
  the lease live (ADR 0015). Also `LeaseClaim`, the answer to asking for the
  lease. Types only.

## Entry point

`index.ts`.

## May import

The core: `config` (the model role).
