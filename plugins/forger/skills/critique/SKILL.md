---
name: critique
description: Forger's own critique step. Score the captures of a visual change against the owner's verbatim brief on feel, readability, feedback and fidelity, and rank the gaps as proposed tickets. Ends in the critique contract.
---

# Critique

Runs unattended in a fresh context after a change the audience sees. Every ticket already passed its acceptance criteria; this step asks whether the whole still serves the brief. It never blocks a merge: its findings feed the backlog.

## Steps

1. Read the brief and the reading of the references. The brief, not the ticket, is the standard. A reference sets a mood; it is not a thing to copy.
2. Open every capture and screenshot named in the input and look at it. Play a recording through. Do not score what you have not seen.
3. Score each dimension from 1 to 5, with the reason in a sentence:
   - **feel**: does it have the character the brief asks for, or is it a faithful but flat simulation?
   - **readability**: what is understood at a glance, within a few seconds of looking?
   - **feedback**: does each action visibly, audibly or kinetically answer the viewer?
   - **fidelity**: does it keep the intent of the reference, not its letter?
4. List findings, most severe first. Each names one dimension, cites one capture or screenshot that shows it, and is phrased as a ticket: the change to make and how it serves the brief. One gap per finding.
5. Rate severity by distance from the brief: `high` when the brief's central ask is missed, `medium` when a visible part falls short, `low` for polish.

## Red flags

- A score with no capture that backs it.
- A finding that restates an acceptance criterion rather than the brief.
- Taste dressed as a finding: say what in the brief it falls short of.
- Several gaps folded into one finding.
- Inventing findings to fill the list: an empty list is a valid answer.

## Exit criteria

- All four dimensions scored with a reason.
- Every finding cites a capture that exists.

## Contract

Leave the `critique` contract at the path the input names. Check it with `contract --slot critique --file <path>`.
