# The engine is laid out by domain, with the layer in the path

The engine's source is one folder per domain under `plugins/forger/engine/src/` (`cli`, `loop`, `backlog`, `checks`, `packs`, `supervisor`, `config`, `ports`, `adapters`). Each folder has a README and an `index.ts` that is its public interface, and other folders import the folder, not the files inside it. The layer map in `.claude/architecture.json` names layers by folder glob: `adapters/` and `cli/` are their own layers and everything else is the core, so a new file is covered by the dependency rule the moment it is created. The core may import only the core, `adapters/` may import the core, and `cli/` may import anything. We chose this over listing pure files one by one because a hand-kept list covered only the files someone remembered to add, and a flat folder said nothing about which files were pure or what they could depend on.

The core still reads and writes its own files (the state file, the lock, a check reading the tree); what it never does is run a command or spawn a process itself. Those arrive through the types in `ports/`, implemented in `adapters/` and handed in by `cli/`, the composition root. Moving every file read behind an adapter would make the core interfaces wider without making a decision more testable.

## Consequences

- A core file that imports an adapter or the CLI is a `check arch` finding.
- The `AutomationRunner` takes its `CommandRunner` and agent spawn as arguments; the CLI is the one place they are real.
- The usage text is generated from the CLI's command registry, so a new command and its help land together.
- A new domain is a new folder with a README and an `index.ts`; a new adapter goes in `adapters/` behind a type in `ports/`.
