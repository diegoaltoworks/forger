# pstack

[pstack](https://github.com/cursor/plugins/tree/main/pstack) is one engineer's
personal stack: go deep first, prove every claim against the real thing, mix
models per role, and deliberately no planning skills. One router,
`poteto-mode`, picks among playbooks. MIT licensed.

## Install

| Harness | How |
|---|---|
| Cursor | `/add-plugin pstack` |
| Claude Code | `/plugin marketplace add cursor/plugins`, then `/plugin install pstack@cursor-plugins`. Skills are named `pstack:<name>`. |

The collection's Claude Code harness notes explain how its Cursor-specific tool
and model names map; read them before first use.

## Slot mapping

Every pstack skill except its setup skill refuses model invocation, so every
slot is a file: forger reads the skill's `SKILL.md` from the install and follows
it.

| Slot | File |
|---|---|
| test_first | `skills/tdd/SKILL.md` |
| review | `skills/interrogate/SKILL.md`: multi-model and adversarial, only findings proven by a run survive |
| risk | `skills/blast-radius/SKILL.md` |
| retro | `skills/reflect/SKILL.md` |

Slots without a fit use forger's own step. A file slot is found under the plugin install, or
as `<name>/SKILL.md` in the user skills directory when the skills are copied in bare.

`create-verification-skill` generates a project verification skill the verifier
could use; it is a one-off setup step, not a slot.

## Do not run under forger

| Skill | Why |
|---|---|
| `poteto-mode` | Its autopilot, orchestrate, shipping and babysit playbooks are a second engine. It is in the flavour's `forbid` list. |
| the Cursor-only automations | They run on Cursor Automations, not in a local loop. |

## Use it

```
bun plugins/forger/bin/work.ts setup --preset pstack
```

See [automating the skills through the factory](README.md) for the pipeline.
