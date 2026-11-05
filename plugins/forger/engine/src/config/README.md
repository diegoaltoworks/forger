# config

`.forger/workloop.config.json`: its defaults, the merge of a project's values
over them, and the model roles.

## Files

- `config.ts` - `mergeConfig` and the defaults are pure, and validate the
  `state` section. `loadConfig` reads the file and resolves its paths.
- `layout.ts` - the only file that names forger's folder. It finds which layout
  a project has (`.forger/`, or the legacy one until `migrate`). It also maps
  logical paths to physical paths for every other folder.
- `home.ts` - `homeOf`, pure: which of main, state, tracker or local each forger
  file belongs to (ADR 0015). A path the table does not name throws.

## Entry point

`index.ts`.

## May import

Nothing outside the folder.
