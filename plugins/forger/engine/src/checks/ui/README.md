# checks/ui

`check ui`: a branch that changes UI files also updates the screenshots that
show them (`ui.evidence`).

## Files

- `ui.ts` - the rule over a parsed diff. Pure.
- `ui-check.ts` - reads `.claude/ui.json` and the branch's diff against its
  merge-base. Touches the world.

## Entry point

`index.ts`.

## May import

The core: `../waivers`, `decisions/`, `ui/`, `config`, `ports`.
