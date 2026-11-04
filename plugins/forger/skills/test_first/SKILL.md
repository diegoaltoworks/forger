---
name: test_first
description: Forger's own test-first step. Write the failing test for each acceptance criterion, make it pass, then refactor. Ends in the tests_written contract.
---

# Test first

Runs unattended inside forger's loop. The ticket and its acceptance criteria are the intent; never ask the owner.

## Steps

1. Read the ticket's acceptance criteria and the code they touch. Find the nearest existing test file and follow its style.
2. For one criterion at a time, write a test that fails for the reason the criterion names. Run only that test and read the failure: it must fail because the behaviour is missing, not because of a typo or a bad import.
3. Write the least code that makes the test pass. Run the test again.
4. Refactor with the test green. Run the neighbouring tests after each refactor.
5. Repeat for the next criterion. A criterion no test can express (documentation, a rename) is waived with a one-line reason.
6. Run the project's gates before you finish.

## Red flags

- A test written after the code, or one that never failed.
- A test that asserts on a mock instead of the behaviour.
- One large test for several criteria: each criterion gets a test that names it.
- A pure decision tested only through the command that wraps it: test the function.
- Editing a test to make it pass.

## Exit criteria

- Every acceptance criterion has a test in your changes, or a waiver with a reason.
- Each test failed before the code and passes now.
- The gates are green.

## Contract

Leave the result in the `tests_written` contract: a list with one entry per criterion, `{criterion, file, test}`, or `{criterion, waived}`. Each file is a test file in your changes. Forger validates it with `contract --slot test_first`.
