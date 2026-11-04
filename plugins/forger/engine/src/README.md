# Engine source

The work-loop engine, one folder per domain. Each folder has a README (what it
owns, which files are pure and which touch the world, what it may import) and
an `index.ts` that is its public interface: other folders import a folder, not
the files inside it.

| Folder | Owns |
|---|---|
| [`cli/`](cli/README.md) | The entry point, the command registry and one file per command group; the composition root |
| [`loop/`](loop/README.md) | The engine's outer loop, one iteration, state, lock, events, outcome, prompt, claim, infra errors, status |
| [`backlog/`](backlog/README.md) | The Backlog interface and its GitHub and file adapters |
| [`checks/`](checks/README.md) | The umbrella `check`, waivers, the CI summary, and one folder per check |
| [`intent/`](intent/README.md) | Classifying a planning request as product or creative |
| [`brand/`](brand/README.md) | The brand rasters and icon, rendered from the SVG sources in `assets/brand/` |
| [`ui/`](ui/README.md) | The ui pack's config, the capture matrix and the screenshot run |
| [`migrate/`](migrate/README.md) | Moving a repo from the legacy layout to `.forger/` |
| [`packs/`](packs/README.md) | Pack manifests, `setup`, skill slots |
| [`pipeline/`](pipeline/README.md) | The pipeline definition, the project overlay and the plan resolved for one ticket |
| [`hooks/`](hooks/README.md) | The harness hook's decision: what a worker or supervisor is refused, and the policy it reads |
| [`supervisor/`](supervisor/README.md) | Read-only facts, the supervisor's decisions, measures and retro records |
| [`config/`](config/README.md) | Loading `.forger/workloop.config.json` and its defaults, and the one place that names forger's folder |
| [`ports/`](ports/README.md) | The types the core is written against and the adapters implement: `CommandRunner`, `AgentRunner`, `Harness`, `AppServer`, `Screenshotter` |
| [`adapters/`](adapters/README.md) | Running a command, spawning the agent, serving and photographing an app |

## The dependency rule

The layer is in the path, and `check arch` enforces it through
`.forger/architecture.json`:

- **core** - every folder except `cli/` and `adapters/`. It may import only the
  core.
- **adapters** - may import the core (the port types).
- **cli** - may import anything; it hands the real adapters to the core.
- Tests sit beside the code they test and may import any layer.

A core file may still read or write its own files (the state file, the lock,
a check reading the tree); each folder's README says which. What the core never
does is spawn a process itself: it receives a `CommandRunner` or a spawn from `cli/`.
