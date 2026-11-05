# Safety

What keeps an unattended worker within bounds.

## Safety

The worker runs headless with `--dangerously-skip-permissions`. Keep the repo's
data-safety and write-scope rules in `.forger/process.md` explicit and enforced
by tests, not convention - the loop will do exactly what the backlog tells it to.
