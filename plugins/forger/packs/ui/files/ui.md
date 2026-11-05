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
in `routes` (and every named state, below) at every viewport and theme, writes
`docs/screenshots/<route>-<viewport>-<theme>.png` and stops the app. The names
are fixed by the config, so a re-run overwrites the same files and the diff
shows what changed. `/` is named `index`.

The command uses the project's own Playwright. When it is missing the command
says how to add it and exits 2, which is an environment problem, not a failure
of the change. The PR body's Screenshots section links the updated files at the
head commit.

## A state is captured by name (ui.named-states)

A filtered list, an error or an open dialog is not its own route, so `routes`
cannot capture it. Declare it under `states` in `.forger/ui.json`: a `name`, a
`route` (a query string is allowed; `/` by default) and optional `steps` run
after the page loads and before the capture. A step is one of `wait` (a
selector to appear), `click` or `tap` (a selector), `fill` (a selector and the
text to type), `key` (a Playwright key name) or `pause` (milliseconds).

```json
{"states": [{"name": "open-filtered", "route": "/tasks?status=open",
  "steps": [{"click": "#filter"}, {"fill": {"selector": "#q", "value": "fix"}}, {"wait": ".row"}]}]}
```

`screenshot` captures every state at every viewport and theme into
`docs/screenshots/<state>-<viewport>-<theme>.png`, beside the route images. A
state name that would overwrite a route's image is refused. Each state named in
a ticket's "UI states" section needs a `states` entry or a route.

## A state is checked, not only looked at (tool: ui.assertions)

A screen can render and still be wrong: a region the wrong colour, a canvas cut
off at the bottom, a banner shown beside the content it should replace. Give a
state an `assert` object and these defects fail before any model looks:

- `no_console_errors` (on by default; `false` turns it off): no console error or
  uncaught exception while the state loads.
- `not_blank`: a selector, or a list, is not one flat colour (a canvas that
  drew nothing).
- `in_viewport`: the box of each selector lies inside the viewport (a view cut
  off at the bottom).
- `visible` and `hidden`: each selector is shown, or is absent or not shown.
- `colour`: the dominant hue of a selector's region falls inside a named arc
  (`red`, `orange`, `yellow`, `green`, `cyan`, `blue`, `purple`, `magenta`) or
  `[from, to]` degrees, plus an optional `tolerance` in degrees. Greys, black
  and white have no hue and fail.

```json
{"states": [{"name": "desert", "route": "/world?biome=desert",
  "steps": [{"wait": "canvas"}],
  "assert": {"not_blank": "canvas", "in_viewport": "canvas", "visible": ".hud",
             "hidden": ".empty-banner",
             "colour": {"selector": "canvas", "hue": "orange", "tolerance": 15}}}]}
```

The assertions run at every viewport and theme. `screenshot` runs them while it
captures: a failure names the state, the viewport, the theme and the assertion,
the images are still written, and the command exits 1. `check ui --states`
serves the app and runs the same assertions without writing images, so a CI job
can fail a PR on them. It needs a browser, so like `check a11y` it runs on its
own and not inside the umbrella `check`, and exits 2 when Playwright or the app
is unavailable.

## Motion is recorded, not described (ui.captures-in-pr)

A still hides motion, feedback and pacing. For interactive or animated work,
declare a capture in `.forger/ui.json`: a name, a `route`, a `viewport` (one of
the declared names; the first by default), `steps` and `max_seconds`. A step is
one of `wait` (a selector to appear), `click` or `tap` (a selector), `key` (a
Playwright key name) or `pause` (milliseconds).

```json
{"captures": [{"name": "play", "route": "/", "viewport": "phone", "max_seconds": 20,
  "steps": [{"wait": "#start"}, {"click": "#start"}, {"key": "ArrowRight"}, {"pause": 800}]}]}
```

`screenshot --capture play` serves the app, plays the steps with Playwright's
video recording and writes `docs/screenshots/play.webm`. When `ffmpeg` is
installed it also writes `docs/screenshots/play.gif`; when it is not, the
command still writes the `.webm`, says how to add `ffmpeg` and exits 2. A script
that runs past `max_seconds` fails. An updated capture counts as UI evidence for
`check ui`, like a still. The PR body's Captures section links the updated
files at the head commit.

Feature docs may embed images from `docs/screenshots/`, so they stay current
with each UI change.

## A UI ticket names its states (ui.states)

The ticket's "UI states" section says what the screen shows when it is empty,
loading, failed and full. A state that is not named is a state nobody
designed. Each one is captured as a route or as a `states` entry (above).

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

## Approved baselines (check: ui.baselines)

The owner approves a state's screenshots once: `ui approve <state>` copies the
committed captures under `.forger/ui-baselines/` and records who approved them
in `approved.json`. The change lands by PR, on the owner's word; `approval
ui_approve` answers `owner`, so a worker never runs it on its own. From then on
`check ui` compares each approved capture with its baseline and fails a
difference beyond the tolerance, writing a side-by-side diff image
(`<capture>.diff.png`: baseline, capture, differing pixels) next to the capture.
The comparison is a pure function of two images and the tolerance:

```json
"tolerance": {"pixel": 16, "area": 0.001}
```

`pixel` is the per-channel difference a pixel may have and still match, which
absorbs anti-aliasing noise; `area` is the share of pixels allowed beyond it.
Both are optional. Re-approving after an intended visual change is again the
owner's action. The verifier is sent only the changed images that have no
baseline on the base branch, and must cite the image it judged. The diff images
are throwaway output; leave them out of commits.

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
