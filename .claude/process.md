# Development process - forger

One ticket per iteration, quality gates green, small clean commits.

## What this repo is

Forger: deterministic tools and skills for an unattended, self-improving
development loop in Claude Code. The plugin lives in `plugins/forger/` (engine in
`plugins/forger/engine/`, commands in `plugins/forger/commands/`, the files a
project adopts in `plugins/forger/templates/`). The process it
encodes lives in `docs/`. Read `README.md`, `docs/01-principles.md`,
`GLOSSARY.md`, `docs/adr/` and `docs/plan-foundation.md` before a ticket.

Forger is built by an existing loop plugin until it can build itself; that is
why `worker_command` is not a forger command yet.

## The gates

The command is `gates` in `.claude/workloop.config.json`. Never proceed on red.
The gates do not yet check the docs; until `forger check docs` is wired in, a
worker checks its own prose against the rules below.

## The tracker

GitHub Issues on this repository, intake label `ready-for-agent`. Claim the
ticket's issue by assigning yourself; close it through the PR with
`Closes #<n>`.

## Rules

1. One ticket per iteration.
2. Gates green before every commit and merge.
3. Read the code a ticket touches, and any reference it names, before writing.
4. One `feat:` PR per ticket (code + tests + docs). Push the branch the moment
   gates are green, before the PR. Squash-merge.
5. Blocked? Signal `<process>stop</process>` with a reason.

## Project gotchas

- **Determinism first** (principle 0, ADR 0002). Every decision a ticket adds or
  changes lands as a tested command with machine-readable output, not as prompt
  text. Commands and skills call tools; prose keeps only judgement.
- **Pure logic is split from I/O.** Follow the engine's existing pattern:
  decisions are pure functions with unit tests; side effects (git, gh, spawn,
  files) sit behind an injectable runner, as in `engine/src/git.ts`.
- **ASCII punctuation only**, in code, docs, commits and PRs: hyphen not dash,
  `->` not arrow glyphs, straight quotes, three periods not an ellipsis.
- **No transient specifics in durable docs**: no counts, timings, dates or
  version-pinned status. Point at the command that computes the number.
- **Nothing personal or project-specific.** No people's names (beyond `LICENSE`
  and the manifest author), accounts, emails, home paths, products, customers or
  issue numbers from other projects. Owner quotes are attributed to "the owner"
  with product nouns made generic ("a record", "a thing"). A local, untracked
  `.forger-denylist` lists terms that must never appear.
- **No third-party skill collections.** Forger carries its own steps.
- **Never wait with `pgrep -f` or `pkill -f` on a pattern that can match your own
  command line.** It hung a worker for a day and a half. Wait on a pid, or on a
  file.
- **Run the engine from source** (`bun plugins/forger/bin/work.ts`), never by
  editing an installed plugin's cache.
- **Comments say why, never narrate a change.** History belongs in the commit.

## The ticket shape

Each entry in `.claude/backlog.json` `features`:

```json
"<ticket_id>": {
  "priority": "P0",
  "status": "not_started",
  "type": "feature",
  "depends_on": [],
  "effort": "medium",
  "issue": 42,
  "title": "the issue title",
  "description": "What and why, enough to implement without guessing.",
  "acceptance_criteria": ["testable outcome"],
  "files": ["hints for a cold start; they go stale"],
  "reuse": ["the pattern to follow"]
}
```
