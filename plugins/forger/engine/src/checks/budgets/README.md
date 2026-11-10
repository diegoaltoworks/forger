# checks/budgets

`check budgets`: any number a project's command prints, held by a ratchet. A
number worse than its recorded one is a finding; `--update` only moves a
recorded number the good way.

## Files

- `budgets.ts` - the config, the baseline, the measurement parse and the
  verdicts. Pure.
- `run.ts` - runs each budget's command through the injected command function and
  reads or writes the baseline. Touches the world.

## Entry point

`index.ts`.

## May import

The core: `../waivers`, `../gaps`, `config`, `ports`.
