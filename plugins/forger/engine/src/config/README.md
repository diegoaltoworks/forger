# config

`.forger/workloop.config.json`: its defaults, the merge of a project's values
over them, and the model roles.

## Files

- `config.ts` - `mergeConfig` and the defaults are pure; `loadConfig` reads the
  file and resolves its paths.
- `layout.ts` - the only file that names forger's folder: which layout a project
  has (`.forger/`, or the legacy one until `migrate`), and the logical-to-physical
  path mapping every other folder goes through.

## Entry point

`index.ts`.

## May import

Nothing outside the folder.
