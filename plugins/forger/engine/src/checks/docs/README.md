# checks/docs

`check docs`: the writing rules (ASCII punctuation, nothing personal, no
hard-coded skills) and the docs pack's rules (links, images, diagrams,
glossary terms). It reads every tracked text file.

## Files

- `docs-rules.ts`, `docs-content.ts`, `docs-slots.ts` - the rules. Pure. `docs-slots.ts` fails a shipped command file that names a slot none of its pipeline stages has.
- `docs-roadmap.ts` - the roadmap rule: every item under a numbered section links its issue. Pure.
- `docs-readme.ts` - the README rule: purpose first, short sentences, active voice, no transient facts. Pure.
- `docs-check.ts` - reads the project files and the denylist. Touches the world.

## Entry point

`index.ts`.

## May import

The core: `../waivers`, `packs`, `ports`.
