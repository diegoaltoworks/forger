# checks/structure

`check structure` keeps the shape of the source tree healthy and ratchets what it cannot fix at once.

It reports oversized folders, shared file prefixes, names that repeat their folder, frozen folders and re-export shims.
It also checks imports: server files missing their guard, browser files that import server files, declared boundaries with external allow-lists, and import cycles.
A baseline records today's findings: a recorded one warns, and an addition fails.

## Files

- `structure.ts` - the config parser and the rules over paths and file text. Pure.
- `baseline.ts` - the ratchet: classify against the record, shrink it, spot growth. Pure.
- `imports.ts` - the import rules, over `check arch`'s extractor and resolver. Pure.
- `structure-check.ts` - lists the files, reads and writes the config and baseline, reads the merge-base's baseline. Reports a SHOULD gap per unread source extension. Touches the world.

## Entry point

`index.ts`.

## May import

The core: `../waivers`, `../gaps`, `../files`, `../arch` (its index only), `decisions/`, `guards/`, `config`, `ports`.
