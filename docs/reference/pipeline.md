# The pipeline

The stages a request goes through, the pipeline definition as data, and the
shapes each slot leaves behind.

## The pipeline

The roles, the lifecycle of a request, ticket statuses and the engine's
outcome decision are drawn in [`docs/02-the-loop.md`](../02-the-loop.md).

```
intent                         plan                       build
/forger:plan  ------------->  tickets + issues  ------>  /forger:work
(interview, plan doc)         (ready-for-agent)          (worker per ticket,
                                    ^                     PR closes the issue)
                                    |
                          /forger:auto-plan adopts
                          a spec or ready issues
```

- **Plan**: `plan` grounds itself in the repo, interviews you in rounds over the
  frontier of open decisions (numbered questions, each with a recommendation),
  then writes a plan doc, ADRs, issues and queued tickets. Vocabulary lives in
  `GLOSSARY.md`, decisions in `docs/adr/`. A request with creative intent (found by
  `work intent`) first gets a creative-brief round: the brief is kept verbatim and
  creative choices come as contrasting options.
- **Intake**: anything labelled `ready-for-agent`, from a planner or a human, is
  adopted into the backlog by the planners and by the worker's work order step, with
  blocking edges mapped to `depends_on`. Issues labelled `wayfinder:*` are
  decisions, not work, and the loop never touches them.
- **Build**: the worker implements one ticket test-first, reviews its own diff on
  standards and spec, makes one honest diagnosis attempt when a gate is red, and
  resolves merge conflicts by hand rather than aborting.

## The pipeline as data

The stages and their order are a definition shipped with the plugin
(`pipeline/default.json`): for each stage its command, inputs, slots (each with
the contract name of its output, an optional `on` event and an optional `when`
condition on the ticket's labels and knock-on paths) and the gate after it.
`pipeline --json [--issue N] [--stage ID]` resolves it for a ticket against the
`skills` mapping and what is installed, and gives the reason for every choice.

A project may add `.forger/pipeline.json`, an overlay that can only disable a
stage, add a slot to a stage or replace a stage's gate:

```json
{
  "disable": ["risk"],
  "add": [{"stage": "review", "slot": {"slot": "review_security", "contract": "review_findings"}}],
  "gates": {"build": "make test"}
}
```

An overlay key that names no stage, or any other key, is reported under
`problems` and the command exits 1.

## Output contracts

Every slot leaves a result in a named shape, and `contract` checks it:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/bin/work.ts contract --slot review --file <path> [--issue N] [--ticket ID --attempt N] --json
```

It prints `{ok, problems}` (plus `next` when not ok) and exits 1 unless the
result is ok. The contracts are `decisions`, `glossary_entries`, `wireframe`, `concepts`,
`tests_written`, `diagnosis`, `review_findings`, `risk_report`, `pr_body`,
`rebase_clean`, `verdict` and `retro_proposals`. Each validator is a pure
function over the parsed result and facts the command gathers: the diff's paths,
the ticket's acceptance criteria, the gates command. `verdict`, `pr_body` and
`rebase_clean` go through the loop's own validators.

When a result fails, `next` says what to do: retry the same skill once with the
problems shown, then run the built-in step, then decline the ticket with reason
`unclear`. With `--ticket` each attempt is recorded as a `contract_attempt`
event. The contract suffix, one string per contract generated from its shape,
tells a skill where to write its result and in what shape.

