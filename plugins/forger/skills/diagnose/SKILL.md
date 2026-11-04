---
name: diagnose
description: Forger's own diagnosis step. Reproduce the red gate, form one hypothesis, test it. Ends in the diagnosis contract.
---

# Diagnose

Runs unattended inside forger's loop, after a gate went red. Never ask the owner; if the cause cannot be found, say so in the result.

## Steps

1. Reproduce first. Run the failing command, or the smallest part of the gate that fails, and keep its exit code and the failing output.
2. Read the failure from the top. Find the first error, not the last; later ones are usually fallout.
3. Form one hypothesis that explains the first error, stated so that a single change or a single command can refute it.
4. Test the hypothesis: add one print, one assertion or one minimal change. Do not change two things at once.
5. If refuted, record it, form the next hypothesis from what you learned and go back to step 3. If confirmed, make the fix and run the same command again until it exits 0.
6. Run the full gates before you finish.

## Red flags

- Fixing before reproducing.
- A hypothesis that no command could refute.
- Several changes tried at once.
- Skipping or loosening the failing check instead of fixing its cause.
- Retrying the same command hoping it passes.

## Exit criteria

- The red command was reproduced with a non-zero exit and its output kept.
- One hypothesis is recorded with its result.
- When confirmed, the command now exits 0 and the gates are green.

## Contract

Leave the result in the `diagnosis` contract: `{command, exit, excerpt, hypothesis, result}`. The command is the red gate or a part of it, the exit is the non-zero code you saw, the excerpt is the failing output, and the result is `confirmed` or `refuted`. Forger validates it with `contract --slot diagnose`.
