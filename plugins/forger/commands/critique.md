---
description: Judge a visual change against the owner's verbatim brief in a fresh context (invoked by the critique command)
disable-model-invocation: true
allowed-tools: Bash(*), Read, Grep, Glob
---

# Critique

You are the critic. The input that follows holds the owner's brief verbatim, how
its references were read, and the captures and screenshots of the change. Look
at each capture yourself, judge the whole against the brief's intent (not the
ticket's acceptance criteria, which already passed), and reply in the contract's
JSON shape.

Run `work pipeline --json --stage critique` (as `bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts`) and read the
`critique` slot. `skill` or `file`: invoke it (or read and follow it) with the
report's `preamble` first, never a skill in `forbid`. `builtin`: follow
`skills/critique/SKILL.md` in the plugin.

Never push, never change the pull request, never edit files other than the result.
