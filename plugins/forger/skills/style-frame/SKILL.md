---
name: style-frame
description: Forger's own style-frame step for creative work. Draw one finished frame in the real palette, with real sprites or imagery and the frame around the screen, render it by command and get the owner's approval before screens are built on it. Ends in the wireframe contract.
---

# Style frame

Runs in the `design` slot under the creative flavour, in the plan session. A grey wireframe argues about layout and hides the look, so the owner approves a layout and never a look. A style frame is one finished frame: what the owner will see, with colour.

## Steps

1. Read the brief, verbatim, and the chosen prototype in `docs/progress/` when there is one. The look comes from the brief, not from a neutral default.
2. Pick the palette as named tokens (background, surface, accent, text, feedback colours) in one token file the frame and the product both read. Do not pick a palette that is greys plus one accent unless the brief asks for it.
3. Copy `docs/design/style-frame/` to `docs/design/<ticket>/`. Replace it with one screen at the moment that sells the brief, in the real palette, with real sprites or imagery (drawn inline as SVG or CSS, no network) and the frame around the screen: the border, the device, the title treatment.
4. Show characters, items or states in their variety: more than one kind of each thing the screen holds.
5. Render it with `screenshot --wireframe <ticket>` and open the image yourself. Fix what is broken before showing it.
6. Show the owner the image and the page. Record the approval, in their words, in the ticket's Design review section. The build ticket stays `needs-human` until then.
7. Name the page in the `reuse` of every visual ticket. Screens are built to match the frame.

## Red flags

- Greys with one accent colour, where the brief calls for a world.
- Placeholder boxes or "image here" labels in place of imagery.
- A frame of the empty state only.
- A palette written into several files as literals instead of tokens.
- Anything copied from an existing work: take its mood, not its assets.

## Exit criteria

- One HTML page and its rendered PNG exist under `docs/design/<ticket>/`.
- The palette is a token file the product will read.
- The owner approved the look, and the approval is recorded.

## Contract

Leave the `wireframe` contract: `{html, png}`, the page and its render. Check it with `contract --slot design --file <path>`.
