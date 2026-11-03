# Opinion packs

Forger holds opinions about how work is done. A pack is a named, versioned set of them, together with the files and checks that carry them. `setup` installs packs into a project, and the lock records what was installed.

## What a pack is

A pack is a directory under `plugins/forger/packs/<name>/`:

- `pack.json`, the manifest: `id`, `version`, `description`, `detect`, `files`, `opinions`, `checks` and `slots`.
- The files it installs, each mapped to a path in the project by the manifest.

An opinion has an id of the form `<pack>.<name>`, a one-line summary, a rung and, when its rung is `check`, the id of the check that enforces it. The manifest is validated when it is loaded; a bad manifest is an error that names the field, never a pack that quietly goes missing.

## The rungs

An opinion's rung is how strongly it holds, taken from the refinement ladder in [`05-refining-the-process.md`](05-refining-the-process.md): `note`, `rule`, `template`, `check`, `tool`. The ladder ends in a check or a tool because prose is a waypoint, not the destination ([ADR 0002](adr/0002-determinism-first.md)).

## Installing and the lock

```mermaid
flowchart LR
    M[pack.json] --> S[setup --packs]
    S --> F[files in the project]
    S --> L[forger.lock.json]
    L --> P[packs --json]
    L --> O[opinions --json]
```

Read it left to right: `setup` reads each chosen pack's manifest, writes its files where they are absent, and records the pack and the hash of each file it wrote in the lock. `packs` and `opinions` read the lock to say what is held.

`setup` never overwrites. A second run writes nothing, and the lock keeps the hash recorded when the file was installed, so a later upgrade can tell a file the project edited from one it did not. A file the project already had is kept and is not recorded, because forger did not install it.

## Commands

- `setup --packs base[,<name>...]` installs by pack; the default is `base`.
- `packs --json` lists the available packs and which are installed.
- `opinions --json` lists every installed opinion with its pack, rung and enforcing check, or none.

## Checks and waivers

```mermaid
flowchart LR
    L[forger.lock.json] --> C[check]
    P[pack manifests] --> C
    C --> V[violations with opinion ids]
    W[waivers.json] --> M{match by id and path}
    V --> M
    M --> R[passed, failed or waived]
```

Read it left to right: `check` takes the checks that the locked packs declare, in lock order, runs each, and matches every violation against the waivers by opinion id and path glob. A check is `passed` with no violations, `waived` when every violation is covered, and `failed` otherwise; any failed check makes the exit code non-zero.

`.forger/waivers.json` is how a project switches an opinion off in the open. Each entry names the opinion, a path glob, a reason and who approved it; an entry missing the reason or the approver is an error, not a waiver. A waiver that matches no violation is reported as stale, so it gets deleted once it is no longer needed.

- `check --json` runs everything and reports per check, plus the stale waivers. `/forger:retro` reads it for the waiver list.
- `check docs` runs the docs check alone, without waivers: the writing rules always, and, when the `docs` pack is installed, the content rules below.
- `setup` appends `check` to the gates.

## The docs pack

The `docs` pack holds the docs habits: Markdown in the repository, a diagram and a reading sentence for every concept, a page that shows each feature, decisions as ADRs. Four of its opinions are enforced by `check docs`, each under its own opinion id so a waiver can target one:

| Opinion | What the check flags |
|---|---|
| `docs.links-resolve` | a relative link or `#anchor` that points at no file or heading |
| `docs.images-resolve` | an image link that points at no file in the repository |
| `docs.diagrams-parse` | a mermaid block with an unknown type, unbalanced brackets or quotes, an arrow with a missing end, or an unclosed subgraph |
| `docs.glossary-terms` | a word from a glossary `_Avoid_:` list, used in prose |

Read the table as a list of ways docs rot quietly. Code spans and fences are never prose, so quoting an avoided word in backticks is fine. A word that is only wrong in one sense carries a parenthetical in the glossary, such as `user (when meaning the owner)`, and is not enforced because a pattern cannot tell the senses apart. Diagram parsing is structural rather than a full mermaid parse: it needs no browser or extra dependency and covers the mistakes that break a render, but it does not validate the grammar of every diagram type.

## The architecture pack

The `architecture` pack holds the architecture forger is built on: pure decisions with I/O at the edges, every external system behind a port, parse at the boundary, fail loud, one source of truth per fact, and deep modules. Two of its opinions are enforced: `architecture.dependency-rule` by `check arch`, and `architecture.decisions-recorded` by `check decisions`.

```mermaid
flowchart LR
    M[.forger/architecture.json] --> G[layer map]
    F[tracked source files] --> X[import extractor]
    X --> E[imports with line numbers]
    G --> K{edge allowed?}
    E --> K
    K -->|no| V[finding: architecture.dependency-rule]
    K -->|yes| O[nothing reported]
```

Read it left to right: the layer map names layers as path globs and says which layer may import which; the extractor lists each file's imports; any import whose edge the map forbids becomes a finding on the importing line.

A layer may always import itself, and files outside every layer, packages and builtins are not constrained. Static, type-only, dynamic, `require` and re-export imports all count. TypeScript and JavaScript are read today; another language is another entry behind the import-extractor interface. A missing or malformed layer map is an error, never a pass. Forger installs the pack on itself and marks its pure modules as the core layer.

### Decisions leave an ADR behind

`check decisions` reads the working tree and branch against the merge-base with the configured base branch. A dependency added to a manifest (`package.json` today; another manifest is another entry behind the manifest-reader interface), or any change to `.forger/architecture.json`, needs a new or changed Markdown file under `docs/adr/` in the same diff. A version bump or a removed dependency is classified and needs no ADR. The pack ships an ADR template with context, decision, consequences and status; an accepted ADR is superseded by a new one, never edited. Like every opinion, it is waivable in `.forger/waivers.json`. A base branch that cannot be resolved is an error, never a pass.

The decision to use packs is [ADR 0003](adr/0003-opinion-packs.md).

## The safety pack

The `safety` pack holds principle 9 (data in production is sacred) and the never-commit-a-secret rule. Two of its opinions are enforced by `check safety`, each under its own opinion id so a waiver can target one:

| Opinion | What the check flags |
|---|---|
| `safety.secrets` | an added line, in the diff or an untracked file, that matches a known credential pattern, or an added `.env` file |
| `safety.data-forward` | a diff that touches `migration_paths` without adding or changing a test under `data_test_paths` |

Both lists live in `.forger/safety.json`. A finding names the file, line and pattern and never prints the match, so a report does not spread the secret it found. The other two opinions, frozen lockfiles in the gates and destructive commands listed in the process gotchas, are rules kept by judgement. Like `check decisions`, the check reads the working tree and branch against the merge-base with the configured base branch, and an unresolvable base is an error, never a pass.

## The testing pack

The `testing` pack holds the testing habits the engine itself relies on. Three of its opinions are enforced, each under its own opinion id so a waiver can target one:

| Opinion | Check | What it flags |
|---|---|---|
| `testing.fix-with-test` | `check tests` | a branch with a `fix:` commit that adds or changes no file matching `test_paths` |
| `testing.no-network` | `check tests` | a unit test file that imports a library named in `network_modules`; files under `integration_paths` are exempt |
| `testing.coverage-ratchet` | `check coverage` | line coverage below the generated baseline, or no baseline yet |

The globs and library list live in `.forger/testing.json`, with the path of the lcov report the project's test command writes and the path of the baseline. The baseline is a generated file: `check coverage --update` creates it or raises it, and never lowers it, so the number lives only there and a deliberate drop is a recorded waiver. A missing or empty coverage report is an error, never a pass. The other opinions (tables for the pure core, fixtures for adapters, tests named for behaviour) are rules kept by judgement. Like `check decisions`, `check tests` reads commits and the working tree against the merge-base with the configured base branch.

## The ui pack

The `ui` pack makes a UI change reviewable by showing it. Evidence, colour tokens and accessibility are enforced; the rest are templates and rules:

| Opinion | Rung | What it asks |
|---|---|---|
| `ui.evidence` | check (`check ui`) | a branch that changes a file matching `paths` also adds or updates a file under `docs/screenshots/` |
| `ui.tokens` | check (`check ui`) | files under `paths` hold no raw colour literal (hex, `rgb()`, `hsl()`) outside the files named by `tokens`; comments are ignored |
| `ui.a11y` | tool (`check a11y`) | axe-core runs on every route at every viewport and theme; serious and critical violations fail |
| `ui.keyboard`, `ui.contrast`, `ui.responsive` | rule | interactive elements work by keyboard, text contrast meets WCAG AA, layouts hold at phone width |
| `ui.wireframe` | template | a ticket that changes a screen gets a wireframe under `docs/design/<ticket>/` first, and the build ticket waits for the owner to approve it |
| `ui.screenshots-in-pr` | template | the PR body's Screenshots section links the updated files at the head commit |
| `ui.states` | template | the ticket's UI states section says what the screen shows when empty, loading, failed and full |

`.forger/ui.json` holds `paths`, the `start` command that serves the app, its `url`, the `routes`, the `viewports` (a phone and a desktop by default) and the `themes` (light and dark). `screenshot` starts the app, waits for it, captures every route x viewport x theme with the project's own Playwright into `docs/screenshots/<route>-<viewport>-<theme>.png`, stops the app and reports the files. The matrix and the names are computed from the config, so a re-run overwrites the same files. When Playwright or the app is unavailable the command says so and exits 2, an environment problem apart from a bad config (exit 1). Feature docs can embed the images, so they stay current with each UI change. The pack adds the `design` skill slot: its built-in step is a static grey-box wireframe in `docs/design/<ticket>/index.html` linking the shipped `wireframe.css`, captured by `screenshot --wireframe <ticket>`, which serves `docs/design/` itself and writes the images beside the page. Wireframes are for screens and diagrams for processes (the docs pack). `check a11y` serves the app the same way and audits each page with the project's own Playwright and `axe-core`; it needs a browser, so it runs on its own rather than inside the umbrella `check`, and exits 2 when the environment lacks either library. Violations are mapped from axe's output by a pure function. Like `check decisions`, `check ui` reads the working tree and branch against the merge-base with the configured base branch.
