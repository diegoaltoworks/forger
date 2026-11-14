# delivery

After a merge, the engine runs the delivery pack's plan (ADR 0022): the project's deploy and check, then its rollback when a step fails.
Without `.forger/deliver.json` nothing here runs.

## Files

- `outcome.ts` - what a delivery leaves in the events, read back per PR.
  It also finds the failed deliveries still waiting on the owner. It builds
  the issue a failure files. Pure.
- `run.ts` - runs one delivery through the injected command ports. It
  brings the checkout to the merged commit and runs the steps. It files the
  issue or comments on the open one, rolls back and records the events. A
  failed rollback halts the loop.

## May import

The core `ports` and `config`, `../events`, and the pack's pure plan in `checks`.
