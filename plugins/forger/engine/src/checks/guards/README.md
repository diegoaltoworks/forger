# checks/guards

`check guards` stops a diff from loosening a guarantee: a lowered minimum, a raised maximum, a deleted guard or test file or an added skip.
A file named in the ticket's Decisions section, written by `decide`, passes.

## Files

- `guards.ts` - the rules over parsed text. Pure.
- `guards-check.ts` - reads the branch's diff, the guard files on both sides and
  the branch's ticket. Touches the world.

## Entry point

`index.ts`.

## May import

The core: `../waivers`, `decisions/`, `config`, `ports`, `ui`.
