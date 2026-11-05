# Creative opinions

What the creative pack holds, and why. Nothing here is a mechanical check: these are templates the ticket carries and rules a reviewer holds the work to. Install the pack beside `ui` for games, demos, animation and canvas-heavy projects.

## A look is drawn before it is built (creative.style-frame, slot: design)

A grey wireframe carries "no colour to argue about", so the owner approves a layout and never a look, and a drab palette gets locked in by whatever is built on it. Under the `creative` flavour the `design` slot draws one finished frame instead: the real palette, real sprites or imagery, and the frame around the screen.

Copy `docs/design/style-frame/` to `docs/design/<ticket>/`, replace it with the real frame and run `screenshot --wireframe <ticket>`. The build ticket stays `needs-human` until the owner approves the look. Select the flavour with `setup --flavour creative`.

## The ticket serves the brief (creative.brief-fit, creative.juice, creative.glanceable)

The pack installs `.forger/templates/ticket-creative.md`, the base ticket with four more sections:

- **Brief fit**: how the change serves the verbatim brief. A ticket that cannot say is probably not needed.
- **Juice**: for each player action or event, the visual, motion and sound feedback. An action with no feedback is a bug in a toy.
- **Readable at a glance**: what a viewer must understand within a few seconds.
- **Time to first interaction**: how long from opening to the first thing the viewer can do, stated in the same section.

## Style is tokens, not a test (creative.palette-tokens, creative.no-style-locking-tests)

Colours come from tokens, and a palette is a set of tokens. A test that asserts every pixel is one of four shades locks a look in and makes the next improvement a test failure. Assert behaviour: the token file exists, the screen reads from it, contrast holds. Review flags a test that locks a style choice. With the `ui` pack installed, `check ui` already fails raw colour literals outside the token files.

## Motion is respected (creative.reduced-motion)

Animation and screen shake stop or soften under the viewer's `prefers-reduced-motion` preference, and the work is still playable without them.

## Nothing is copied (creative.original)

A reference sets a mood. Names, characters, sprites, music and layouts from an existing work are not reproduced.
