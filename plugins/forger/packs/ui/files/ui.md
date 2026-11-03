# UI opinions

What the ui pack holds, and why. A rule marked "check" is enforced by
`check ui`; the rest are templates the ticket and the PR carry.

## A UI change is seen, not described (check: ui.evidence)

A reviewer cannot judge a screen from a diff. `check ui` fails a branch that
changes a file matching `paths` in `.forger/ui.json` unless the same branch
also adds or updates a file under `docs/screenshots/`. Run `screenshot` to
produce them; do not take them by hand.

## Screenshots come from a command (ui.screenshots-in-pr)

`screenshot` starts the app with `start`, waits for `url`, captures every route
in `routes` at every viewport and theme, writes
`docs/screenshots/<route>-<viewport>-<theme>.png` and stops the app. The names
are fixed by the config, so a re-run overwrites the same files and the diff
shows what changed. `/` is named `index`.

The command uses the project's own Playwright. When it is missing the command
says how to add it and exits 2, which is an environment problem, not a failure
of the change. The PR body's Screenshots section links the updated files at the
head commit.

Feature docs may embed images from `docs/screenshots/`, so they stay current
with each UI change.

## A UI ticket names its states (ui.states)

The ticket's "UI states" section says what the screen shows when it is empty,
loading, failed and full. A state that is not named is a state nobody
designed.

## A screen is drawn before it is built (ui.wireframe, slot: design)

A wireframe is cheaper to change than a screen. When a ticket changes a screen,
`/forger:plan` runs the `design` slot first and the build ticket stays
`needs-human` until the owner approves what was drawn.

The built-in step needs no design tool. Copy `docs/design/example/` to
`docs/design/<ticket>/` and replace the boxes: static HTML linking the shared
`docs/design/wireframe.css`, greys and boxes, no brand. Then run
`screenshot --wireframe <ticket>`, which serves `docs/design/` itself and writes
`<ticket>-<viewport>-light.png` beside the page. The ticket's Design review
section links the page and the images. Diagrams are for processes (the docs
pack); wireframes are for screens.

## Colours come from tokens (check: ui.tokens)

`check ui` also fails a raw colour literal - hex, `rgb()`, `hsl()` and their
alpha forms - in a text file under `paths`, unless the file matches `tokens` in
`.forger/ui.json`. Define a colour once in a token file and reference it
everywhere else. Comments are ignored. A deliberate exception is a waiver, in
the open.

## Accessibility is run, not remembered (tool: ui.a11y)

`check a11y` serves the app like `screenshot`, runs axe-core on every route at
every viewport and theme, and fails on serious and critical violations. It uses
the project's own Playwright and `axe-core`; when either is missing it says how
to add it and exits 2, an environment problem rather than a failure of the
change. It needs a browser, so it runs on its own and not inside the umbrella
`check`; run it in CI where a browser is available.

## Rules a reviewer holds the screen to

- Every interactive element is reachable and operable by keyboard (ui.keyboard).
- Text contrast meets WCAG AA (ui.contrast); axe reports the measurable cases.
- Layouts hold at phone width (ui.responsive); the phone screenshot shows it.
