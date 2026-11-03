# UI opinions

What the ui pack holds, and why. A rule marked "check" is enforced by
`check ui`; the rest are templates the ticket and the PR carry.

## A UI change is seen, not described (check: ui.evidence)

A reviewer cannot judge a screen from a diff. `check ui` fails a branch that
changes a file matching `paths` in `.claude/ui.json` unless the same branch
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
