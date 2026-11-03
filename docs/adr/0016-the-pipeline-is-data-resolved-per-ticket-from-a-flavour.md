# The pipeline is data, resolved per ticket from a flavour

Status: Proposed

The owner: "I want forger to be similar out of the box, but also, allow devs to bring their own flavour. in the end, forger will create a structured deterministic pipeline that consumes the right skills available in the right ways".

Today the pipeline is prose. The stages and their order live in the command files (`plan.md`, `auto-ticket.md`, `verify.md`, `retro.md`); each built-in step is a one-line string in `SLOTS` (`engine/src/packs/skills.ts`); a project maps one skill name per slot; and whatever a mapped skill writes is consumed as-is. This record designs the pipeline as a declared definition, an output contract per slot, forger's own skills as the out-of-the-box built-ins, flavours as named selections over the pipeline, and one pure resolution that turns all of it into the plan for one ticket. The findings with their evidence are in the pull request that carries this record.

## 1. The pipeline as data

Options:

- **(a) Keep the order in the commands**, and only grow the slot table. Cheap, and the order stays something no tool can read, check or explain.
- **(b) A definition file per command**, each listing its own steps. The order becomes data, but a stage that spans commands (build, then verify, then merge) is split across files and the gates between them are still prose.
- **(c) One pipeline definition** for the whole factory: every stage, in order, with its command, its inputs, its slots, the output contract of each slot and the gate after the stage. The commands become thin steps that ask the engine which stage they are in and what to run. Chosen.

The definition ships as `plugins/forger/pipeline/default.json`. A project may add `.forger/pipeline.json`, which is an overlay, not a copy: it may disable a stage, add a slot to a stage, or replace a gate command, and nothing else, so a forger upgrade still changes the default stages for every project that did not touch them. The merge of default and overlay is a pure function; an overlay key that names no stage or slot is reported, as `skills --json` reports an unknown slot today.

The default definition, the worked example:

```json
{
  "version": 1,
  "stages": [
    {"id": "intake", "command": "plan", "inputs": ["owner_request", "inbox"],
     "slots": [
       {"slot": "interview", "contract": "decisions"},
       {"slot": "glossary", "contract": "glossary_entries"},
       {"slot": "design", "contract": "wireframe", "when": {"labels_any": ["ui"]}}
     ],
     "gate": "check docs"},
    {"id": "plan", "command": "auto-plan", "inputs": ["spec", "decisions"],
     "slots": [],
     "gate": "backlog --json"},
    {"id": "build", "command": "auto-ticket", "inputs": ["ticket", "slice"],
     "slots": [
       {"slot": "test_first", "contract": "tests_written"},
       {"slot": "diagnose", "contract": "diagnosis", "on": "gate_red"}
     ],
     "gate": "gates"},
    {"id": "review", "command": "auto-ticket", "inputs": ["diff", "ticket"],
     "slots": [{"slot": "review", "contract": "review_findings"}],
     "gate": "contract review_findings"},
    {"id": "risk", "command": "auto-ticket", "inputs": ["diff", "ticket"],
     "slots": [{"slot": "risk", "contract": "risk_report"}],
     "gate": "contract risk_report"},
    {"id": "pr", "command": "auto-ticket", "inputs": ["diff", "ticket", "review_findings", "risk_report"],
     "slots": [
       {"slot": "pr_body", "contract": "pr_body"},
       {"slot": "merge_conflicts", "contract": "rebase_clean", "on": "rebase_conflict"}
     ],
     "gate": "rebase"},
    {"id": "verify", "command": "verify", "inputs": ["pr", "ticket"],
     "slots": [{"slot": "verify", "contract": "verdict"}],
     "gate": "verify --json"},
    {"id": "merge", "command": "auto-ticket", "inputs": ["pr", "verdict"],
     "slots": [],
     "gate": "merge --json"},
    {"id": "retro", "command": "retro", "inputs": ["measure", "events"],
     "slots": [{"slot": "retro", "contract": "retro_proposals"}],
     "gate": "check"}
  ]
}
```

A slot with `on` runs only when that event happens in the stage (a red gate, a conflicting rebase); a slot with `when` runs only for the tickets its condition matches. Both are fields the resolver reads, not prose a model weighs.

**Commands read the plan.** A command keeps its judgement prose (how to interview, how to write a test) and loses its ordering prose. It starts with `pipeline --json --stage <id> [--issue N]` and runs the slots it returns, in order, each through the invocation the plan names. The command files stop listing the slot names themselves; a docs check fails a command that names a slot the definition does not give its stages, so the two cannot drift.

## 2. Output contracts

Every slot has a contract: the shape of the result the next stage consumes, and the tool that validates it. A skill writes its result to `<state dir>/runs/<ticket>/<slot>.json` (or `.md` for `pr_body`), the command running the slot calls `contract --slot <slot> --file <path> --json`, and the validator is a pure function over the parsed result plus facts the caller passes in (the diff's paths, the gate's exit code), as the verdict validator in `loop/verdict.ts` already is.

| Slot | Contract | Shape | Validated by |
|---|---|---|---|
| interview | `decisions` | `[{question, answer, source: owner or default, recommended}]`, at least one entry or an explicit `none` | `contract --slot interview`: every question has an answer; a `default` answer carries the recommended one |
| glossary | `glossary_entries` | `[{term, file}]` and `[{adr, file}]` | `contract --slot glossary`: each term appears in the named file in the diff; plus `check docs` |
| design | `wireframe` | `{html, png}` paths | `contract --slot design`: both exist and the png came from `screenshot --wireframe` |
| test_first | `tests_written` | `[{criterion, file, test}]` | `contract --slot test_first`: each file is in the diff and is a test file by the testing pack's patterns; every acceptance criterion the ticket parses is named or explicitly waived |
| diagnose | `diagnosis` | `{command, exit, excerpt, hypothesis, result: confirmed or refuted}` | `contract --slot diagnose`: the command is the red gate or a part of it, `exit` is non-zero, the excerpt is non-empty |
| review | `review_findings` | `[{severity, file, line, summary, disposition: fixed or declined, reason}]` | `contract --slot review`: each file is in the diff; each finding at medium or above has a disposition, and a `declined` one a reason |
| risk | `risk_report` | `{beyond_diff: [{path, why}], ran: [{command, exit}]}` | `contract --slot risk`: every command has an exit code; the report is input to the worker, never a verdict (ADR 0010) |
| pr_body | `pr_body` | markdown | `contract --slot pr_body`: keeps `Closes #<n>` and the ticket's review sections (`docs/03-tickets.md`) |
| merge_conflicts | `rebase_clean` | the `rebase --json` result | `rebase --json` reports `clean`, then the gates |
| verify | `verdict` | the verdict record (ADR 0010) | `verify --json` through `loop/verdict.ts` (exists) |
| retro | `retro_proposals` | `[{lesson, rung: check, test, tool or doc, target}]` | `contract --slot retro`: each proposal names a rung of the refinement ladder (`docs/05-refining-the-process.md`) and a target path |

**When a result fails its contract.** A pure policy, `onContractFailure(attempt, slot)`, decides; the command only acts on it:

1. **Retry once** with the same skill, the contract's problems and the shape shown to it.
2. **Then the built-in step**, which writes to the same contract.
3. **Then a decline** with reason `unclear` and the problems as the detail, through the existing `decline` command, so the run ends in a recorded outcome, never in a merge of unchecked work.

Each attempt is an event, so `measure` can report a skill's contract failure rate per slot.

**Adapting a free-form community skill.** A community skill does not know forger's contracts. The engine does not ask it to: the slot's invocation is wrapped in the unattended preamble (#148) plus a contract suffix, one string per contract generated from the contract's schema, that says "when you finish, write your result to `<path>` in this shape". The skill's own steps are unchanged. A skill that ignores the suffix fails its contract and is handled by the policy above; the failure rate then tells the owner which community skill fits forger and which does not.

## 3. Strong built-ins, out of the box

Options:

- **(a) Keep built-ins as one-line strings.** What a project gets today with no collection installed.
- **(b) Built-ins as forger's own skills**: one `SKILL.md` per slot in `plugins/forger/skills/<slot>/`, portable across harnesses because a `SKILL.md` is read as a file (#148's file slot), at the depth of the collections: steps, red flags, exit criteria, written for unattended runs and ending in the slot's contract. Chosen.

The one-line string stays in `SLOTS` as the summary `skills --json` prints; the step itself is the file. A slot whose built-in file is missing falls back to the line, so a partial build is never worse than today.

**Which first.** The slots every ticket runs, in this order: `review`, `test_first`, `diagnose`, then `pr_body` and `risk` once #149 adds them. `interview`, `glossary` and `design` follow; they run once per request, not per ticket.

**Evaluated, not asserted.** Each slot gets fixtures under `plugins/forger/evals/<slot>/<case>/`: an input (a diff, a red gate's output, a ticket) and the properties a good result has (the planted defect is found, the reproduced command is the failing one). `eval --slot <slot> --skill <name or file> --json` runs the skill on each case and scores the result with the slot's contract validator plus the case's properties. Scoring is deterministic; only the run is a model's. The same cases score a built-in and a community skill, so "is pstack's `interrogate` better than forger's review here" is a table, not an opinion.

## 4. Flavours

A flavour is a named, versioned selection over the pipeline: for each slot, an ordered list of candidates with conditions, and the built-in as the implicit last candidate.

```json
{
  "name": "mixed",
  "version": 1,
  "description": "The strongest fit per slot across the three community collections.",
  "slots": {
    "interview": [{"skill": "mattpocock-skills:grilling"}],
    "glossary": [{"skill": "mattpocock-skills:domain-modeling"}],
    "test_first": [{"skill": "mattpocock-skills:tdd"}],
    "review": [
      {"skill": "agent-skills:code-review-and-quality", "when": {"labels_none": ["ui"]}},
      {"file": "pstack/skills/interrogate/SKILL.md", "when": {"labels_any": ["ui"]}}
    ],
    "risk": [{"file": "pstack/skills/blast-radius/SKILL.md", "when": {"paths_any": ["**/migrate/**", "**/state*"]}}],
    "diagnose": [{"skill": "mattpocock-skills:diagnosing-bugs"}],
    "pr_body": [{"skill": "mattpocock-skills:pr"}]
  }
}
```

- **Conditions** are `labels_any`, `labels_none`, `paths_any` (globs over the ticket's knock-on paths, the footprint ADR 0011 already parses) and `packs_all` (installed opinion packs). All present keys must hold. The first candidate whose conditions hold and whose skill or file is installed wins; otherwise the built-in.
- **Two reviewers** are two entries in a stage's `slots` with the same slot id and different names (`review`, `review_security`) in the pipeline overlay; a flavour maps each. The second is never a merge gate; the verifier stays the only one.
- **Where flavours live.** Shipped flavours in `plugins/forger/flavours/`; a project may add its own in `.forger/flavours/`. The config names one: `"flavour": "mixed@1"`. The version pins the selection so a flavour change upstream is an upgrade the owner takes, reported by `packs upgrade` as pack versions are.
- **Overrides.** The existing `skills` map in the config stays and wins over the flavour for the slots it names, so every project configured today keeps its behaviour. No `flavour` and no `skills` is the `default` flavour: forger's own built-ins everywhere.
- **Presets become flavours.** `mattpocock-skills.json` and the presets #150 adds are flavours with one candidate per slot; `setup --preset <name>` keeps working as an alias of `setup --flavour <name>`.

## 5. Deterministic resolution

`pipeline --json [--issue N] [--stage <id>]` resolves the definition, the overlay, the flavour, the overrides and what is installed into the exact plan for one ticket: each stage, each slot that runs, the skill chosen, how it is invoked (`skill` by name, `file` by path, #148), the contract and the reason. Without `--issue` it resolves for a ticket with no labels and no paths, which is what a slot falls back to.

`resolvePipeline(definition, overlay, flavour, overrides, installed, ticket)` is pure and tested with a table. The I/O (reading the files, listing installed skills, reading the issue's labels and knock-on) sits in `cli/`. The resolved plan is stored with the run, in the run facts and the iteration log, so a run is explainable after the fact and a re-run with the same inputs resolves the same way.

The four example plans below are abbreviated to the stages with slots; `contract` is omitted where the table in section 2 gives it. Ticket A is a backend fix (labels `bug`; knock-on `engine/src/loop/merge.ts`). Ticket B is a UI feature (labels `ui`; knock-on `app/screens/settings/`).

**Ticket A, flavour `default`:**

```json
{"ticket": "issue-201", "flavour": "default@1", "stages": [
  {"id": "build", "slots": [
    {"slot": "test_first", "invoke": "file", "target": "<plugin>/skills/test_first/SKILL.md", "reason": "builtin: flavour default"},
    {"slot": "diagnose", "invoke": "file", "target": "<plugin>/skills/diagnose/SKILL.md", "on": "gate_red", "reason": "builtin: flavour default"}]},
  {"id": "review", "slots": [
    {"slot": "review", "invoke": "file", "target": "<plugin>/skills/review/SKILL.md", "reason": "builtin: flavour default"}]},
  {"id": "risk", "slots": [
    {"slot": "risk", "invoke": "file", "target": "<plugin>/skills/risk/SKILL.md", "reason": "builtin: flavour default"}]},
  {"id": "pr", "slots": [
    {"slot": "pr_body", "invoke": "file", "target": "<plugin>/skills/pr_body/SKILL.md", "reason": "builtin: flavour default"},
    {"slot": "merge_conflicts", "invoke": "builtin", "target": "Resolve the conflict by hand and re-run the gates", "on": "rebase_conflict", "reason": "builtin: no skill file yet"}]}
]}
```

**Ticket B, flavour `default`:** as ticket A, plus the `design` slot, whose `when` matches `ui`:

```json
{"ticket": "issue-202", "flavour": "default@1", "stages": [
  {"id": "intake", "slots": [
    {"slot": "design", "invoke": "file", "target": "<plugin>/skills/design/SKILL.md", "reason": "builtin: flavour default; when labels_any [ui] holds"}]},
  {"id": "build", "slots": [
    {"slot": "test_first", "invoke": "file", "target": "<plugin>/skills/test_first/SKILL.md", "reason": "builtin: flavour default"},
    {"slot": "diagnose", "invoke": "file", "target": "<plugin>/skills/diagnose/SKILL.md", "on": "gate_red", "reason": "builtin: flavour default"}]},
  {"id": "review", "slots": [
    {"slot": "review", "invoke": "file", "target": "<plugin>/skills/review/SKILL.md", "reason": "builtin: flavour default"}]},
  {"id": "risk", "slots": [
    {"slot": "risk", "invoke": "file", "target": "<plugin>/skills/risk/SKILL.md", "reason": "builtin: flavour default"}]},
  {"id": "pr", "slots": [
    {"slot": "pr_body", "invoke": "file", "target": "<plugin>/skills/pr_body/SKILL.md", "reason": "builtin: flavour default"},
    {"slot": "merge_conflicts", "invoke": "builtin", "target": "Resolve the conflict by hand and re-run the gates", "on": "rebase_conflict", "reason": "builtin: no skill file yet"}]}
]}
```

**Ticket A, flavour `mixed`:**

```json
{"ticket": "issue-201", "flavour": "mixed@1", "stages": [
  {"id": "build", "slots": [
    {"slot": "test_first", "invoke": "skill", "target": "mattpocock-skills:tdd", "reason": "mixed candidate 1"},
    {"slot": "diagnose", "invoke": "skill", "target": "mattpocock-skills:diagnosing-bugs", "on": "gate_red", "reason": "mixed candidate 1"}]},
  {"id": "review", "slots": [
    {"slot": "review", "invoke": "skill", "target": "agent-skills:code-review-and-quality", "reason": "mixed candidate 1: labels_none [ui] holds"}]},
  {"id": "risk", "slots": [
    {"slot": "risk", "invoke": "file", "target": "<plugin>/skills/risk/SKILL.md", "reason": "builtin: mixed candidate 1 paths_any did not match engine/src/loop/merge.ts"}]},
  {"id": "pr", "slots": [
    {"slot": "pr_body", "invoke": "skill", "target": "mattpocock-skills:pr", "reason": "mixed candidate 1"},
    {"slot": "merge_conflicts", "invoke": "builtin", "target": "Resolve the conflict by hand and re-run the gates", "on": "rebase_conflict", "reason": "builtin: flavour maps nothing"}]}
]}
```

**Ticket B, flavour `mixed`, with pstack not installed:**

```json
{"ticket": "issue-202", "flavour": "mixed@1", "stages": [
  {"id": "intake", "slots": [
    {"slot": "design", "invoke": "file", "target": "<plugin>/skills/design/SKILL.md", "reason": "builtin: flavour maps nothing"}]},
  {"id": "build", "slots": [
    {"slot": "test_first", "invoke": "skill", "target": "mattpocock-skills:tdd", "reason": "mixed candidate 1"},
    {"slot": "diagnose", "invoke": "skill", "target": "mattpocock-skills:diagnosing-bugs", "on": "gate_red", "reason": "mixed candidate 1"}]},
  {"id": "review", "slots": [
    {"slot": "review", "invoke": "file", "target": "<plugin>/skills/review/SKILL.md", "reason": "builtin: mixed candidate 1 labels_none [ui] failed; candidate 2 pstack/skills/interrogate/SKILL.md not installed"}]},
  {"id": "risk", "slots": [
    {"slot": "risk", "invoke": "file", "target": "<plugin>/skills/risk/SKILL.md", "reason": "builtin: mixed candidate 1 paths_any did not match app/screens/settings/"}]},
  {"id": "pr", "slots": [
    {"slot": "pr_body", "invoke": "skill", "target": "mattpocock-skills:pr", "reason": "mixed candidate 1"},
    {"slot": "merge_conflicts", "invoke": "builtin", "target": "Resolve the conflict by hand and re-run the gates", "on": "rebase_conflict", "reason": "builtin: flavour maps nothing"}]}
]}
```

The reason strings are what make a run explainable: each says which candidate won, or why each one before the built-in did not.

## 6. How #148, #149 and #150 fit

- **#148 stands.** The file slot is the `invoke: file` the plan reports, and forger's own built-in skills are file slots too. The unattended preamble is the wrapper every slot invocation gets; the contract suffix (section 2) is appended to it, built in a later ticket. Collection roots and aliases are how a flavour candidate's `file` path and bare skill names resolve.
- **#149 stands.** `risk`, `pr_body` and `retro` are added as slots with built-in steps; each declares the contract this record names, and the `pr_body` check it already asks for is that contract's first validator.
- **#150's presets become flavours**, and its docs describe the pipeline, the out-of-the-box skills and flavours rather than presets alone. It is blocked by the flavour ticket as well as #148 and #149.

## Recommendation

Adopt (c) for the pipeline and (b) for the built-ins, with flavours over both. Defaults, for the owner to overturn:

1. One pipeline definition shipped with the plugin; a project overlay may only disable, add and replace a gate, never reorder.
2. One contract per slot, validated by `contract --slot`, a pure validator per contract.
3. On a contract failure: one retry with the problems shown, then the built-in, then a decline with reason `unclear`.
4. Forger's own skills first for `review`, `test_first` and `diagnose`, then `pr_body` and `risk`, each with eval fixtures.
5. Flavour candidates are tried in order; the first whose conditions hold and that is installed wins; the built-in is always last. The `skills` map wins over the flavour.
6. No configuration is the `default` flavour, and a project configured today resolves as before.

## Consequences

- Every decision this record proposes is a pure function or a tested command: the overlay merge, the contract validators, the contract-failure policy, the resolution, the eval scoring. The prompt keeps the judgement inside each slot and nothing about order or choice.
- The command files lose their ordering prose; a check keeps them in step with the definition.
- A flavour change is visible before a run (`pipeline --json`) and after it (the stored plan), so swapping a skill is a decision with a reason, not a silent change of behaviour.
- The cost is a contract per slot to maintain and a results directory per run. The contract failure rate per skill, in `measure`, says whether a contract is too strict.
- Build work is filed as separate tickets awaiting triage (#153 to #158), in an order where each is useful alone: the pipeline definition and `pipeline --json` over today's slots; output contracts and `contract --slot`; the resolved plan stored with the run and the commands reading it; flavours with conditions; forger's own skills for the per-ticket slots; then evals that score a skill on fixtures.
