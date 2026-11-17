# checks/commands

`check commands`: a command file the harness reads from the repository that is
missing, ignored by git or not tracked is a finding. A worker runs in a
worktree made from the base branch, which holds tracked files only.

## Files

- `rules.ts` - the rules over what git says about each command file. Pure.
- `git-facts.ts` - asks git about the paths the caller passes. Touches the
  world. No paths means no call to git: a harness that loads the plugin for the
  session has no command files.

## Entry point

`index.ts`.

## May import

The core: `../waivers`, `rules`, `ports`.
