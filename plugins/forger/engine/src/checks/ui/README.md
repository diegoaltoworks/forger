# checks/ui

`check ui`: a branch that changes UI files also updates the screenshots that
show them (`ui.evidence`), and UI files hold no raw colour literal (`ui.tokens`).
`check a11y` (`ui.a11y`) audits the served app with axe.

## Files

- `ui.ts` - the rule over a parsed diff. Pure.
- `tokens.ts` - finds colour literals in file contents, comments blanked. Pure.
- `a11y.ts` - maps axe results to findings; serious and critical block. Pure.
- `ui-check.ts` - reads `.claude/ui.json`, the branch's diff against its
  merge-base and the UI files. Touches the world.
- `a11y-check.ts` - serves the app, audits every route x viewport x theme
  through the `AppServer` and `AccessibilityAuditor` ports, stops the app.

## Entry point

`index.ts`.

## May import

The core: `../waivers`, `decisions/`, `ui/`, `config`, `ports`.
