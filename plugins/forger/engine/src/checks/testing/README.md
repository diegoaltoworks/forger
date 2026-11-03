# checks/testing

`check tests` and `check coverage`: a fix lands with a test, a unit test stays
off the network, and line coverage never drops below the baseline.

## Files

- `testing.ts` - the rules, the lcov parse and the baseline. Pure.
- `testing-check.ts` - reads the commits, the diff, the test files, the
  coverage report and the baseline; writes a raised baseline. Touches the world.

## Entry point

`index.ts`.

## May import

The core: `../waivers`, `decisions/`, `config`, `ports`.
