---
description: Turn a signal (owner correction, failure, friction, cost) into the cheapest durable change to the process, by PR
disable-model-invocation: true
allowed-tools: Bash(*), Read, Write, Edit, Grep, Glob
---

# Retro

Refine the process from one signal. The method is `docs/05-refining-the-process.md`;
this command walks it with tools doing the counting and the writing. Judgement
stays here (the cause, the rung); numbers and files come from commands. Run
every command from the repo root as `bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts <command>`;
call it `work`.

Run `work pipeline --json --stage retro` and read the `retro` slot. `skill` or `file`: invoke it
(or read and follow it) with the report's `preamble` first, never a skill in
`forbid`, and treat its output as `retro_proposals` to carry through steps 3 to 6.
`builtin`, or the tool failing: the steps below.

## 1. Capture

Take the signal verbatim from `$ARGUMENTS` or the conversation: the owner's
words, or the failure, with its date and where it was seen. Do not paraphrase.

## 2. Find the cause

- `work check --json`: the checks' state and the waivers in force, including stale ones.
- `work measure --json [--last N]`: runs and failures by cause, terminal events,
  how cleared halts were explained (a not-a-defect reason that keeps coming back
  is a ticket),
  and time, budget cap and CI rounds per ticket. Compare the ticket in question
  with the rest before blaming it.
- For a failure, build the timeline in `.forger/templates/retro.md` from the
  worker's session transcript and CI's logs. Name each layer (worker, skill,
  engine, platform) and do not stop at the first plausible cause.
- For friction, list every place it recurred.
- `work retro demote --list`: opinions that do not earn their place. Report the candidates; for one the owner wants pursued, `work retro demote --opinion <id>` prints the issue draft. The owner decides each demotion.

## 3. Choose the form

Pick the cheapest rung on the ladder in `docs/05-refining-the-process.md` that
will actually be followed. Search for an existing rule first (`.forger/rules/`,
`.forger/process.md`); update it rather than adding a second.

## 4. Write it

- A rule record: `work retro rule --name <slug> --description <line> --type <feedback|project|user|reference> --rule <text> --owner "<verbatim words>" --date <YYYY-MM-DD> --why <text> --how <text> [--enforced-by <what>]`.
  It writes `.forger/rules/<slug>.md` in the shape of `.forger/templates/rule.md`.
- A process rule, template section or check: edit the project's own installed
  files. A check is a ticket, not prose.
- Never write a measure into a durable doc; name the command.

## 5. Decide where it lands

If the lesson holds for every project, not just this one, draft an upstream
issue with the evidence (the `measure` output, the timeline lines):

```
work retro upstream --title "<title>" --lesson "<text>" --evidence "<fact>" [--evidence "<fact>" ...]
```

Show the draft. File it on forger only with the owner's approval. A lesson specific to this project stays in this project.

## 6. Land and tell

Apply the change now to the open work it affects, land it by a PR (never push to
the base branch), and tell the owner in one line what changed and where.
