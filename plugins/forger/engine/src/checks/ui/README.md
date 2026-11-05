# checks/ui

`check ui` finds a branch that changes UI files without updating their
screenshots (`ui.evidence`). It also finds raw colour literals (`ui.tokens`)
and captures that drift from their baselines (`ui.baselines`). `check a11y`
(`ui.a11y`) audits the served app with axe.

## Files

- `ui.ts` - the rule over a parsed diff. Pure.
- `tokens.ts` - finds colour literals in file contents, comments blanked. Pure.
- `a11y.ts` - maps axe results to findings; serious and critical block. Pure.
- `baseline-check.ts` - compares every approved capture with its baseline image and writes the diff image beside a changed one.
- `states-check.ts` - `check ui --states`: serves the app and loads every
  named state through the `AppServer` and `Screenshotter` ports. It maps
  failed assertions to findings.
- `ui-check.ts` - reads `.forger/ui.json`, the branch's diff against its
  merge-base and the UI files. Touches the world.
- `a11y-check.ts` - serves the app, audits every route x viewport x theme
  through the `AppServer` and `AccessibilityAuditor` ports, stops the app.

## Entry point

`index.ts`.

## May import

The core: `../waivers`, `decisions/`, `ui/`, `config`, `ports`.
