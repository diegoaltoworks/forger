# Plan: forger foundation

## Goal

Make forger stand on its own: a deterministic core that a model cannot talk its
way around, a loop that reports what actually happened, and the first working
pieces of the self-improving layer. Forger is built by an existing loop
(see "How it is built") until it can build itself.

The long-term direction is a loop that heals itself, learns and adapts. A project
starts with forger's opinions installed as files it owns; the supervisor and the
retro refine those files from every correction and failure; lessons that hold
for every project go upstream into forger's own defaults and tools. See
[principle 0](01-principles.md) and [ADR 0002](adr/0002-determinism-first.md).

## In scope

- **Engine fixes** from the failure catalogue: timeouts that really end the
  worker, outcomes decided from facts, infrastructure errors told apart from
  worker failures, HALT and counter hygiene, one engine at a time, a
  machine-readable status.
- **GitHub Issues as the backlog**, with the file backlog as the fallback
  ([ADR 0001](adr/0001-github-issues-are-the-backlog.md)), and the engine's
  types named in the glossary's words: Backlog and Ticket.
- **Pure forger**: no dependency on third-party skill collections.
- **A docs check** in the gates: ASCII punctuation and the scrub rules, with
  personal terms kept in a local, untracked denylist.
- **The failure catalogue and roadmap** completed from the original project's
  evidence, with nothing specific to that project or its people.
- **The supervisor** as `/forger:work`, and **refinement** as `/forger:retro`
  with measuring commands.
- **Setup** that installs forger's opinions into a project.

## Out of scope

- Running the loop off one machine (hosted runners, a VM, an app).
- Moving any existing project onto forger.
- A sample repository and evals.

## How it is built

Until forger is installed, the existing loop plugin builds it: its worker
command runs against this repository. Once the timeout fix merges, the engine is
run from this repository's source, so the fix protects the rest of the build.
Installing forger as a local plugin, beside the existing one, is an owner step.

## Build order

The backlog's `depends_on` is the order; in outline:

1. Engine timeouts, then outcomes from facts.
2. The Backlog interface, then the GitHub backlog.
3. Infrastructure errors and HALT hygiene; one engine and machine-readable status.
4. Pure forger; the docs check; then the catalogue and roadmap import.
5. Setup installs the opinions; the supervisor; the retro and its measures.

## Open questions and owner steps

- Push the first commit to the remote, which starts a fresh history.
- Give the loop a GitHub token scoped to the account that owns the remote,
  without changing the machine-wide active account.
- Install forger locally when it is ready to try.
