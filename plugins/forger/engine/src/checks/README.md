# checks

`check`: every check the installed packs declare, with waivers applied, as one
report. Each check is its own folder with pure rules beside a thin file that
reads the tree and hands it to them.

## Files

- `checks.ts` - the umbrella check and its report. Reads the lock and waivers.
- `waivers.ts` - findings, waivers and path globs, shared by every check. Pure.
- `ci.ts` - the CI job summary and the workflow the loop's CI runs. Pure.
- `docs/`, `arch/`, `decisions/`, `safety/`, `testing/` - one check each; see
  their READMEs.

## Entry point

`index.ts`: the umbrella check and every single check. A check folder may
import `../waivers` directly; every other folder goes through `index.ts`.

## May import

The core: `config`, `packs`, `ports`.
