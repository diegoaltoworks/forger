# Roadmap

Work not yet done, in order. Each item links the issue that tracks it. Built work
is not listed; open failures are in the Open table of
[the failure catalogue](06-failure-catalogue.md#open).

## 1. Prove forger off itself

- Run the first replay of the owner requests on the sample repository and record the report: [#109](https://github.com/diegoaltoworks/forger/issues/109).
- Prove the loop in OpenCode, Codex and Copilot, one merged ticket each: [#275](https://github.com/diegoaltoworks/forger/issues/275), within [the harness plan](https://github.com/diegoaltoworks/forger/issues/270).

## 2. Opinion packs and the spec pack

- Opinion packs a project adopts and refines: [#33](https://github.com/diegoaltoworks/forger/issues/33).
- A TypeScript spec provider proven on fixtures: [#82](https://github.com/diegoaltoworks/forger/issues/82).
- Trial the spec pack on a product repository: [#81](https://github.com/diegoaltoworks/forger/issues/81).

## 3. Creative projects

- Build things people enjoy, not only things that pass: [#236](https://github.com/diegoaltoworks/forger/issues/236).

## 4. Off one machine

- CI-native mode: a scheduled supervisor job and a dispatched worker job, with the sample repository as the first target: [#300](https://github.com/diegoaltoworks/forger/issues/300). The design for state is [ADR 0015](adr/0015-loop-state-lives-on-a-state-branch-and-in-the-tracker.md), the sample repository [ADR 0012](adr/0012-a-sample-product-repository-proves-forger-off-itself.md).
- A hosted app over the same playbook, state and commands: [#301](https://github.com/diegoaltoworks/forger/issues/301).

## 5. Generalise

- Nothing project-specific in commands and templates, and the ticket sections as a configurable set: [#302](https://github.com/diegoaltoworks/forger/issues/302). The pipeline design is [ADR 0016](adr/0016-the-pipeline-is-data-resolved-per-ticket-from-a-flavour.md).

## Settled

- **Licence and openness:** MIT, open source.
- **Where it lives:** this repository is the single source of the plugin and its marketplace.
- **The name:** forger.
- **The tracker:** GitHub Issues are the backlog; see [ADR 0001](adr/0001-github-issues-are-the-backlog.md).
- **Determinism first:** see [ADR 0002](adr/0002-determinism-first.md).
- **Dependencies:** none on third-party skill collections. Forger carries its
  own interview, test-first, review and diagnosis steps, with their decisions in
  tools.
