# Forger's files live in .forger/, and the harness is an adapter

Status: Accepted

Forger's backlog, state, log, config, opinions, templates and locks sat in `.claude/`, the folder of one agent tool, and the engine named that path in many places. A user of another tool would have forger's state inside a folder that tool does not own, mixed with settings and instruction files forger does not own, and ADR 0005 had made the model and the harness replaceable in everything but the folder name.

## Decision

1. **One folder, one owner.** Everything the engine reads or writes lives in `.forger/`. One file in `config/` owns the folder name and maps logical `.forger/` paths to where a project keeps them; no other engine source names the harness folder. Harness files (a tool's settings, its instruction file) stay where that tool expects them.
2. **Existing installs keep working.** With no `.forger/` and a config in `.claude/`, the engine reads the legacy layout and prints one warning naming `migrate`. `migrate` moves the forger-owned entries with `git mv` where tracked, repoints the references inside the moved config and lock, gitignores the per-run files in their new home, does nothing on a second run, and refuses while an engine holds the lock.
3. **The harness is a seam.** `Harness` names how the worker is spawned headless, where its commands are installed and the variable that holds the plugin root. The `harness` config key picks one, defaulting to the first adapter. A second adapter, OpenCode, proves the seam with two cases.
4. **The steps exist once.** The commands in the plugin are the single source; an adapter repackages them (frontmatter, plugin root) and never keeps a copy per harness.

We chose a new folder over a symlink or a configurable root because a symlink hides which tool owns what, and a configurable root leaves every default pointing at a harness.

## Consequences

- Fresh setups write `.forger/` only, plus the harness's own command files.
- This repository's own loop state lives in `.forger/`. A repository moves by an owner step while no engine runs, since the loop runs from those files: stop the engine, run `migrate`, restart.
- Packs install to logical `.forger/` targets; the lock records them logically, so a lock written before the move reads the same after it.
- OpenCode takes a model as `provider/model` and has no spend cap, so a project using it maps the roles under `models` to such ids and the tier budget is not enforced by the harness.
- Other harnesses are follow-up adapters, each a file in `adapters/` with a table test of its spawn arguments and install path.
