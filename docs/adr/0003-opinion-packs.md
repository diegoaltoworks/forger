# Opinions ship as packs

Forger's opinions were one fixed list of files copied by `setup`. They are now packs: a directory under `plugins/forger/packs/<name>/` with a `pack.json` manifest (id, version, description, detect, files, opinions, checks, slots) and the files it installs. `setup --packs a,b` installs the chosen packs, defaulting to `base`, and writes `.claude/forger.lock.json` with each installed pack's id and version and the sha256 of every file it wrote. Every opinion carries a rung on the refinement ladder (`note`, `rule`, `template`, `check`, `tool`) and, when its rung is `check`, the id of the check that enforces it. We chose this over a growing list of flags on `setup` because a project must be able to choose, enforce, waive and upgrade opinions one pack at a time, and each of those needs a stable id and a recorded version to act on.

The manifest is parsed once at the boundary into a typed value, and a bad manifest is an error that names the field; a pack is never skipped silently, because a skipped pack is an opinion the project believes it holds and does not (ADR 0002).

## Consequences

- The lock records what forger installed, not what the project made of it: a file the project already had is kept and not recorded, and a recorded hash is never rewritten by a later run, so a later upgrade can tell an edited file from a pristine one.
- `packs --json` and `opinions --json` are the machine view of what is available and what is held.
- Enforcement, waivers, upgrades and pack suggestions build on the id and rung and are separate tickets.
