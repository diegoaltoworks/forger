# agent-skills

[agent-skills](https://github.com/addyosmani/agent-skills) is a lifecycle
collection of process skills covering Define, Plan, Build, Verify, Review and
Ship. Each skill gives steps, a table of common rationalizations, red flags and
exit criteria, and the collection runs evals in CI. It is built for a human
checkpoint at each phase, so under forger the unattended preamble stands in for
the checkpoint. MIT licensed.

## Install

| Harness | How |
|---|---|
| Claude Code | `/plugin marketplace add addyosmani/agent-skills`, then `/plugin install agent-skills@addy-agent-skills`. Skills are named `agent-skills:<name>`. |
| Codex, Copilot CLI | native install, see the collection's setup docs |
| Cursor, OpenCode, Copilot, Gemini and others | copy the skills in, see the collection's `docs/*-setup.md`; they carry no prefix |

Forger resolves a skill with or without the prefix.

## Slot mapping

| Slot | Skill |
|---|---|
| interview | `interview-me` (interactive plan only) |
| glossary | `documentation-and-adrs` |
| test_first | `test-driven-development` |
| review | `code-review-and-quality` |
| diagnose | `debugging-and-error-recovery` |
| risk | `doubt-driven-development`; `security-and-hardening` first for a ticket labelled `security` |

Slots without a fit (design, pr_body, merge_conflicts, retro) use forger's own
step. Every skill here is invoked by name; none needs a file slot.

`constraint-driven-development` ships `scripts/quality-gate.mjs`, a diff-only
guard against suppressions, skipped tests and lowered thresholds. It is worth
wiring into your gates command; it is not a slot.

## Do not run under forger

| Skill | Why |
|---|---|
| `using-agent-skills` | A second router that picks skills itself; forger's pipeline already decides which step runs. It is in the flavour's `forbid` list. |
| `/build auto` | A second loop. Forger's engine owns the loop. |
| any skill that commits | Forger commits, pushes and merges. The unattended preamble tells a skill not to; keep it that way. |

## Use it

```
bun plugins/forger/bin/work.ts setup --preset agent-skills
```

See [automating the skills through the factory](README.md) for the pipeline.
