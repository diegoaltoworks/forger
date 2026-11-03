# Any model, any harness: forger names roles, not models

Forger's core is a set of deterministic commands with machine-readable output. Any model that can run a command and read its JSON can work between those boundaries, so the model, and the harness that runs it, are adapters. We chose this over describing forger as tied to one vendor's models because the tie is not real: it follows from determinism first (ADR 0002), where every decision lives in a tool and the model is replaceable, and a doc that hides that invites lock-in and mis-sets what a reader may swap.

A model is chosen per role for cost and quality, never because a decision depends on it. The config names roles (`fast`, `standard`, `deep`) and maps them to model ids; a tier that names anything else is taken as a literal model id, so existing configs keep working. The agent spawn sits behind the `AgentRunner` port, and the shipped adapter is the one place a harness is named in code.

## Consequences

- Prose names the role (the worker, the supervisor, the agent adapter), not a model or a vendor. The plugin README's adapter section is the one place that says what ships today.
- `check docs` flags a configured list of model and vendor names in Markdown outside the adapter docs; the rule is `base.model-agnostic` and is waivable like any other.
- A second harness is a new file in `adapters/` implementing `AgentRunner`, plus its own packaging of the commands; the loop and the engine do not change.
- Tickets, logs and docs name the tier; only the adapter sees the model id.
