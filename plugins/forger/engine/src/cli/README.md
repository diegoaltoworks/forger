# cli

The command line: parse the flags, find the consumer repo, reach the stage the
command needs, run its handler. This is the composition root, the one place the
real `CommandRunner` and agent spawn from `adapters/` are handed to the core.

## Files

- `main.ts` - `main` and `findProjectRoot`; builds the command context. Touches
  the world (cwd, home, files).
- `registry.ts` - every command in usage order; the usage text is generated
  from it. Pure.
- `command.ts`, `flags.ts` - the command shape, the stages and the flag table.
  Pure.
- One file per command group (`loop.ts`, `check.ts`, `setup.ts`, `facts.ts`,
  ...) - each handler prints its output and sets the exit code; some read or
  write the files their command names.
- `open-backlog.ts` - which Backlog a config selects, wired to a real or an
  injected `CommandRunner`.

A new command is a `Command` in its group's file plus one line in
`registry.ts`; its flags go in `flags.ts`.

## Entry point

`index.ts`: `main`, `findProjectRoot`, `COMMANDS`, `renderHelp`. The plugin's
`bin/work.ts` imports `main` from here.

## May import

Anything.
