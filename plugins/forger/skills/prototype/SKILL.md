---
name: prototype
description: Forger's own prototype step. Build two or three throwaway single-file concepts that differ on the axis the brief leaves open, so the owner reacts to something real before tickets. Ends in the concepts contract.
---

# Prototype

Runs inside the plan session, only for creative intent and after the creative-brief round. The owner is present: the brief, verbatim, is the intent, and the owner picks. Prototype code is a sketch to react to, never product source.

## Steps

1. Read the brief and the interpretation of each reference. Name the axis the brief leaves open (for example watch versus play, palette, tone). When it leaves several open, pick the one that changes the experience most and say so.
2. Build two or three concepts, each one HTML file that opens by double click: inline style and script, no build, no network. Each takes a different side of the axis and is playable or watchable within moments of opening.
3. Put them under `docs/progress/prototype/`, one file per concept. They are outside the product source, so the product's gates and architecture rules do not apply to them.
4. Open each file yourself (the browser lens, or `screenshot`) and fix anything broken before showing it.
5. Give each concept a one-line pitch and the axis it varies.
6. Show the owner all concepts and let them pick one, or a mix of named parts. Record the pick and why, in their words, in the plan doc under "Prototype pick".
7. Keep the chosen concept in `docs/progress/` as the reference and name its path in the `reuse` of every visual ticket. Delete the others, or keep them there marked as not chosen.

## Red flags

- Concepts that differ only in colour when the brief left a different axis open.
- A concept that needs a server, a build step or the network.
- A recommended concept: the owner picks, you do not steer.
- Prototype code copied into the product source, or imported by it.
- Polishing one concept before the others exist.

## Exit criteria

- Two or three concepts exist, each a single HTML file that opens on its own.
- The owner's pick and the reason are in the plan doc.
- The reference is archived under `docs/progress/`.

## Contract

Leave the `concepts` contract: a list of `{path, axis, pitch}`, one per concept. Check it with `contract --slot prototype --file <path>`.
