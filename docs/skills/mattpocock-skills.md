# mattpocock-skills

[mattpocock-skills](https://github.com/mattpocock/skills) is a set of small,
composable skills from one engineer's daily use, pitched against frameworks that
own the process. Model-invoked skills hold the discipline; user-invoked skills
orchestrate. MIT licensed.

## Install

| Harness | How |
|---|---|
| Claude Code | `claude plugin install mattpocock-skills@claude-plugins-official`. Skills are named `mattpocock-skills:<name>`. |
| Codex, Copilot | through the `mattpocock` marketplace |
| Others | `npx skills add mattpocock/skills`; skills carry no prefix |

Run the collection's own setup skill once per repository so its tracker docs
exist. Forger resolves a skill with or without the prefix.

## Slot mapping

| Slot | Skill | Invoked |
|---|---|---|
| interview | `grilling` | by name |
| glossary | `domain-modeling` | by name |
| test_first | `tdd` | by name |
| review | `code-review` | by name |
| diagnose | `diagnosing-bugs` | by name |
| pr_body | `pr` | by name |
| retro | `retro` | by file: it is user-invoked, so forger reads `skills/engineering/retro/SKILL.md` from the install |

merge_conflicts stays with forger's own step because the collection no longer
carries a conflict skill. `prototype` builds variants on a throwaway branch, not
a wireframe, so the design slot also stays built-in.

## Do not run under forger

| Skill | Why |
|---|---|
| `implement-spec` | Its own parallel loop; forger's engine owns the loop. |
| `implement` | Builds a ticket end to end, which is the worker's job. |
| `to-spec`, `to-tickets`, `triage`, `wayfinder` | They write the backlog and set its labels; forger's plan and intake commands do, with tested tools. |
| `ask-matt` | A router that picks skills itself. |

All are in the flavour's `forbid` list.

## Use it

```
bun plugins/forger/bin/work.ts setup --preset mattpocock-skills
```

See [automating the skills through the factory](README.md) for the pipeline.
