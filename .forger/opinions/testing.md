# Testing opinions

What the testing pack holds, and why. A rule marked "check" is enforced by
`check tests` or `check coverage`; the rest are judgement, kept by whoever
writes the code.

## Tables for the pure core

Decisions are pure functions, so they are tested by tables: a list of inputs
and the output each must give. A new case is one more row, and a failing row
names the input that broke. Reach for a mock only at an edge.

## Fixtures for adapters

An adapter (git, a tracker, a browser, a model) is tested on recorded real
output saved as a fixture, so the test proves the parser handles what the
service really says. A unit test never calls the live service.

## A fix lands with the test that failed before it (check: testing.fix-with-test)

A bug that returns was fixed without a test. `check tests` fails a branch whose
commits include a `fix:` subject unless the diff also adds or changes a file
matching `test_paths` in `.forger/testing.json`. Write the failing test first,
see it fail for the right reason, then fix.

## Unit tests stay off the network (check: testing.no-network)

A unit test that reaches the network or spawns a process is slow, flaky and
hides the seam it should have. `check tests` flags a test file that imports one
of `network_modules`; tests under `integration_paths` are exempt, so a slow
test has a home that is named. Rewrite both lists to match your tree.

## Tests are named for behaviour

`rejects a lockfile that would change` outlives a refactor; `test parseLock`
does not. The name is the sentence a failing run prints.

## Coverage never goes down (check: testing.coverage-ratchet)

`check coverage` compares the line coverage of the lcov report the test command
writes (`coverage_report`) with the generated baseline file
(`coverage_baseline`) and fails on a drop. `check coverage --update` raises the
baseline when coverage has risen and never lowers it; commit the raised file
with the work that earned it. The number lives only in that generated file,
never in a doc. A drop that is deliberate is a recorded waiver, not an edited
baseline.
