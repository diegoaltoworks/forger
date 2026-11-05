# Skill slots

The points of judgement in the loop, how a project maps a skill onto each, and
how to compare two skills on one slot.

## Bring your own skills

Forger incorporates any skill you have installed. The points where a model does
judgement work are named **skill slots**, and each has a built-in forger step:

| Slot | Used by | Built-in step |
|---|---|---|
| `interview` | `plan` | numbered rounds of open decisions, each with a recommendation |
| `glossary` | `plan` | terms into `GLOSSARY.md`, decisions into `docs/adr/` |
| `prototype` | `plan` | creative intent only: two or three throwaway single-file HTML concepts that differ on the axis the brief leaves open; the owner's pick is recorded in the plan doc and the chosen one archived under `docs/progress/` |
| `design` | `plan` | a grey-box HTML wireframe under `docs/design/<ticket>/`, captured by `screenshot --wireframe` (with the ui pack); the `creative` flavour draws a finished style frame instead (with the creative pack) |
| `test_first` | `auto-ticket` | failing test, then pass, then refactor |
| `review` | `auto-ticket` | the diff against the base, on standards and spec |
| `diagnose` | `auto-ticket` | reproduce the red gate, one hypothesis, test it |
| `merge_conflicts` | `auto-ticket` | resolve by hand, re-run the gates |
| `risk` | `auto-ticket` | list what the change touches beyond the diff, run the tests for it (input to the worker, never a verdict) |
| `pr_body` | `auto-ticket` | write the PR body by `docs/03-tickets.md`; `pr-body` keeps `Closes #<n>` and the review sections |
| `critique` | `critique` | after a merged change the audience sees: score the captures against the verbatim brief on feel, readability, feedback and fidelity, and rank findings as proposed tickets; those above a threshold are filed, none blocks a merge |
| `retro` | `retro` | the retro steps as written |

`test_first`, `review` and `diagnose` ship as full skills under
`skills/<slot>/SKILL.md`, with steps, red flags, exit criteria and the slot's
output contract, written for unattended runs. With nothing mapped, `skills --json`
and `pipeline --json` report them as `invoke: file`; if the file is missing the
one-line step above runs instead. A project's skills map or flavour still wins.

Map a slot to a skill in the `skills` section of `.forger/workloop.config.json`:

```json
{ "skills": { "review": "some-collection:code-review" } }
```

A slot can also point at a file, for a skill the harness will not invoke by name
(many collections mark their skills as user-invoked only):

```json
{ "skills": { "review": { "file": "skills/code-review/SKILL.md" } } }
```

A relative path is looked up under each installed plugin's root, then under the
forger plugin root; an absolute path is used as it is. The worker reads the file
and follows it.

An unmapped slot, a skill that is not installed, or a file that is missing uses
the built-in step. The commands never name a skill: they run `skills --json`,
which reports for every slot how it is invoked (`invoke`: `skill`, `file` or
`builtin`), the resolved `path` of a file slot, and whether it is present. It
also reports the `preamble` and the `forbid` list.

## Comparing skills

Whether a built-in or a community skill is better at a slot is measured, not
argued. `evals/<slot>/<case>/` holds the cases for `review`, `test_first` and
`diagnose`: `input.md` is the task the skill is given (a diff with a planted
defect, a red gate's output, a ticket) and `case.json` holds the facts the
contract validator needs and the properties a good result has.

```
work.ts eval --slot review --skill builtin
work.ts eval --slot review --skill some-collection:code-review
work.ts eval --slot review --skill path/to/SKILL.md --json
```

`--skill` is `builtin`, an installed skill's name, or a file. The skill runs on
every case through the project's harness; each result is scored by the slot's
contract validator plus the case's properties, and the scores are printed and
written to the output directory as a generated report. The exit code is 1 unless
every case passes. Run two skills on the same slot to compare them on the same
cases.

Every `skill` or `file` invocation starts with the engine-owned `preamble`: the
intent is the ticket and its spec, never ask the owner (an open question is a
decline), do not commit, push, merge or open pull requests (forger does), and do
not route to another skill or start a loop. A flavour's `forbid` lists the skills
of its collection the worker must not invoke: routers, loops and anything that
owns the process.

**Flavours.** A flavour is a named, versioned selection of skills: per slot an
ordered list of candidates, each a `skill` or a `file`, with optional `when`
conditions (`labels_any`, `labels_none`, `paths_any` over the ticket's knock-on
paths, `packs_all` over the installed opinion packs; every key present must hold).
The first candidate whose conditions hold and which is installed wins; otherwise
the built-in step, which is the implicit last candidate.

```json
{
  "name": "mine",
  "version": 1,
  "description": "A reviewer for UI tickets, the default otherwise.",
  "slots": {
    "review": [
      {"skill": "some-collection:ui-review", "when": {"labels_any": ["ui"]}},
      {"skill": "some-collection:review"}
    ]
  }
}
```

Shipped flavours live in `plugins/forger/flavours/` (`default` is forger's own
built-ins); a project adds its own as `.forger/flavours/<name>.json`, and a
project file beats a shipped one of the same name. The config picks one with
`"flavour": "<name>@<version>"`; the version pins the choice, and a flavour whose
version differs is refused until the owner changes the pin. `setup --upgrade`
reports a newer shipped version of the pinned flavour. No `flavour` is `default`.
The config's `skills` map still wins per slot, so a project configured with only
a `skills` map behaves as before.

`pipeline --json [--issue N]` shows the choice per slot for one ticket and the
reason: which candidate won, or why each one before the built-in did not.
`skills --json` resolves the flavour for a ticket with no labels and no paths.

**The `creative` flavour** maps no collection: it resolves the `design` slot to forger's own style-frame step, for games, demos and animation (see the creative pack).

**Shipped collection flavours.** `agent-skills`, `mattpocock-skills` and `pstack`
each map one collection onto the slots it fits, and `mixed` takes the strongest fit
per slot across all three. `/forger:setup` offers a flavour when its collection is
installed, or apply one directly with `setup --flavour <name>` (`--preset` is the
same). A flavour is a plain file: copy it to map another collection. Besides the
slot mapping it declares how to find the collection (`collection` and `plugin`
for a prefixed plugin install, `aliases` for the bare skill names of an install
without a prefix) and the `forbid` list, so detection and resolution work with or
without the prefix. A skill that refuses model invocation is mapped as a `file`,
relative to the plugin install. The pages under
[`docs/skills/`](../skills/README.md) cover each collection.

**The `design` slot** (ui pack) maps like any other. Examples: a Figma MCP
server for boards, a prototype skill from an installed collection, or artifacts
in an interactive session. Unmapped, the built-in step needs no tool: a static
grey-box wireframe in `docs/design/<ticket>/`, captured with
`screenshot --wireframe <ticket>`.

