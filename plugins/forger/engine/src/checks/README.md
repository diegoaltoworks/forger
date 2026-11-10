# checks

`check`: every check the installed packs declare, with waivers applied, as one
report. Each check is its own folder with pure rules beside a thin file that
reads the tree and hands it to them.

## Files

- `checks.ts` - the umbrella check and its report. Reads the lock and waivers.
- `waivers.ts` - findings, waivers and path globs, shared by every check. Pure.
- `gaps.ts` - coverage gaps (a check that could not measure something) and the
  modality-to-severity mapping. Pure.
- `files.ts` - the files a check scans: tracked, and untracked but not ignored.
  The local gates see an unstaged file before it is committed.
- `ci.ts` - the CI job summary and the workflow the loop's CI runs. Pure.
- `record/` - the per-opinion records of a `check` run inside a worker, appended
  to `paths.checks`. The records are pure; the append is the only I/O.
- `docs/`, `arch/`, `decisions/`, `guards/`, `hooks/`, `journeys/`, `safety/`, `spec/`, `structure/`, `testing/`, `ui/` - one check each; see
  their READMEs.

## Entry point

`index.ts`: the umbrella check and every single check. A check folder may
import `../waivers` and `../files` directly; every other folder goes through `index.ts`.

## May import

The core: `config`, `hooks`, `packs`, `ports`, `ui`.
