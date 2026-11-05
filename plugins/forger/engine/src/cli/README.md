# cli

The command line: it parses the flags, finds the consumer repo and runs the
handler of a command. This is the composition root, the one place that hands
the real `CommandRunner` and agent spawn from `adapters/` to the core.

## Files

- `main.ts` - `main` and `findProjectRoot` (the git top-level, else the
  nearest forger folder, never home). It builds the command context. Touches
  the world (cwd, home, files).
- `registry.ts` - every command in usage order; the usage text is generated
  from it. Pure.
- `command.ts`, `flags.ts` - the command shape, the stages and the flag table.
  Pure.
- `pipeline.ts` - `pipeline --json`: reads the ticket's labels and knock-on through `gh`, hands them to `pipeline/`.
- `critique.ts` - `critique --pr`: wires the PR, the tracker (`gh issue create`) and the agent into `critique/`.
- `replay.ts` - `replay --file`: reads a requests file and files its issues in order through `replay/`.
- `contract.ts` - `contract --slot`: gathers the diff, the ticket's criteria
  and the gates command. It hands them to the validators in `pipeline/` and
  records the attempt.
- `intent.ts` - `intent --request`: reads the repo's manifest dependencies and prints the `intent/` classification.
- `eval.ts` - `eval --slot`: loads a slot's cases and runs the skill on each
  through the harness agent. It scores the results in `pipeline/` and writes the report.
- One file per command group (`loop.ts`, `check.ts`, `setup.ts`, `facts.ts`,
  ...). Each handler prints its output and sets the exit code. Some read or
  write the files their command names.
- `open-backlog.ts` - which Backlog a config selects, wired to a real or an
  injected `CommandRunner`.

To add a command, write a `Command` in its group's file. Add one line in
`registry.ts`, and put its flags in `flags.ts`.

## Entry point

`index.ts`: `main`, `findProjectRoot`, `COMMANDS`, `renderHelp`. The plugin's
`bin/work.ts` imports `main` from here.

## May import

Anything.
