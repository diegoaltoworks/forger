# Setup fixtures

Sample projects that `setup` is tested against in CI, so a setup bug fails a pull request instead of being found by hand on a new repository.

A fixture is a directory under `projects/`. Adding one needs no change to the CI job.

`run.integration.ts` copies each fixture into a project directory inside a temporary HOME that holds an unrelated `~/.claude`, then runs `packs --detect`, `setup` with the packs it suggested, the gates, `check coverage --update` and the gates with `check` as a whole. `assertions.ts` holds the pure assertions on what it observed, one per setup bug the demo repositories hit: the project root, an absolute home path in the config, test detection and the coverage report.

An optional `fixture.json` in the fixture gives:

- `gates`: the gates passed to `setup --gates`. They must write the lcov report the testing pack reads.
- `starter`: the project has no source file, so `setup` copies a starter and its own gates run; `--gates` is not passed.
- `prepare`: a command that installs the tools the gates need. It runs in the project and may use `$FIXTURE_TOOLS`, a scratch directory outside the project.

Run it locally with `bun test/fixtures/run.integration.ts [fixture...]`, and the assertions' own tests with `bun test test/fixtures/assertions.test.ts`.
