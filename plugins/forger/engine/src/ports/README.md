# ports

The shapes the core is written against for the side effects it does not perform
itself: running a command, and spawning the agent for one iteration. `adapters/`
implements them and `cli/` hands the implementations in.

## Files

- `command.ts` - `CommandRunner`, `CapturingRunner`, `CommandResult`, and
  `capturing` to see one as the other. Pure.
- `ui.ts` - `AppServer`, `Screenshotter` and `AccessibilityAuditor`, what
  `screenshot` and `check a11y` are written against, and the error for an environment that cannot capture. Types only.
- `spec.ts` - `SpecProvider` and the normalized requirement report `check spec`
  decides over. Types only.
- `agent.ts` - `AgentRunner`, what a worker run is given and what it returns.
  Types only.
- `harness.ts` - `Harness`, what differs between agent tools: the headless spawn,
  where commands are installed, the plugin-root variable. Types only.

## Entry point

`index.ts`.

## May import

The core: `config` (the model role).
