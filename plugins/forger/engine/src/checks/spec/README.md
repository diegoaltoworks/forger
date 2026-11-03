# checks/spec

`check spec`: the requirements an issue names are satisfied, and no MUST that
was satisfied on the base is lost. Decided over a normalized report, whichever
provider produced it.

## Files

- `spec.ts` - reading `Satisfies:` lines, and the decision over the named IDs,
  the head report and the base report. Pure.
- `spec-check.ts` - finds the branch's issue and asks the provider for the
  reports. Touches the world.

## Entry point

`index.ts`.

## May import

The core: `../gaps`, `../waivers`, `ports`.
