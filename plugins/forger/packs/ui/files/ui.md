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

## Every locale is captured, right-to-left included (ui.locales)

Text that fits in one language breaks in another, and a right-to-left layout
mirrors in ways a left-to-right review never sees. Declare `locales` in
`.forger/ui.json`: each has a `code`, a `dir` (`ltr` or `rtl`) and a way to
switch the app to it, either a `param` (the query parameter the app reads, so
`?lang=ar` is added to every url) or `steps` (run before the capture's own, for
an app switched by a control). The sample file declares one of each direction.

When `locales` is set, `screenshot` captures every route and state in every
locale and names the files `<route>-<locale>-<viewport>-<theme>.png`. The page
runs in the locale and with `dir` set on its root, so the layout is the
mirrored one. Without `locales` the names and behaviour are unchanged.

## Before and after, side by side (ui.before-after)

`screenshot --before` also captures the base branch, from a worktree of its own
that the command creates and removes, then writes one image per changed screen
under `docs/screenshots/compare/`, the before on the left and the after on the
right. Screens whose two captures match within the tolerance get no image, and
a screen the base does not have has nothing to set beside. The base checkout
serves the app with the same `start` command, so it needs what the app needs to
start; install dependencies in the way your `start` expects.

The PR body's Screenshots section links these files where the owner reviews
them (ui.renders-for-reviewer). In a public repository, link the files at the
head commit. In a private repository a `blob/...?raw=true` link loads only in a
browser signed in to github.com, and the GitHub mobile app shows it as a broken
image. So also link a page that shows the images, or use uploaded attachments,
and name the app the owner reviews in. Check that the link opens there
before asking for review.

## Screenshots on their own branch (ui.screenshots-branch)

Set `screenshots_branch` in `.forger/ui.json` to keep screenshots on a branch
of their own, which keeps PR diffs small. `check ui` then accepts a UI change
whose PR body links an image or video on that branch, as well as files changed
under `docs/screenshots/`. With neither, it fails.

## The narrowest viewport is captured (ui.narrowest-viewport)

The capture matrix includes the narrowest width the project supports, often
320 px, as well as a typical phone. `check ui` warns, without failing, when no
viewport in `ui.json` is 360 px wide or less.

## Type floors (ui.type-floors)

Text inputs stay at 16 px or larger: below that, iOS Safari zooms the page when
one takes focus. A locale whose script reads worse small (Arabic, the Indic
scripts) keeps its larger sizes when the type scale shrinks for a narrow
viewport.

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

## An absolute rule is measured first (tool: ui.measure)

A design rule such as "never shrinks", "always one line" or "same size
everywhere" is a claim about space. Before work starts, run
`measure <route-or-state> <selector>`: for each element the selector matches it
reports the text width against the width available, and whether the text wraps
or is clipped, at every viewport and locale of `ui.json` at a text scale of 100%
and 200% (the page's root font size, so sizes in `rem` follow). The worst case
is printed first. `--text <file>` fills the element with the longest string of a
translation file, so the worst case is the longest real value. Put the output in
the ticket; `check ticket` warns on an absolute with no measured number.

## Rules a reviewer holds the screen to

- Every interactive element is reachable and operable by keyboard (ui.keyboard).
- Text contrast meets WCAG AA (ui.contrast); axe reports the measurable cases.
- Layouts hold at phone width (ui.responsive); the phone screenshot shows it.
