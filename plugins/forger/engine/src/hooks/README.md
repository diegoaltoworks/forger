# hooks

The harness hook that refuses what a worker is only asked not to do. The same
hook guards the supervisor.

It refuses a merge by hand, a push to the base branch and a forced push. It
refuses a commit status, a check run and an edit of the engine's state. For a worker started in a worktree it refuses a
write to, or a `cd` into, the loop's checkout outside that worktree. While
an engine is alive, it refuses state-changing git in the loop's checkout.

## Files

- `shell.ts` - the simple commands of a command line, with quotes, chains,
  wrappers (`env`, `sudo`, `bash -c`, `eval`) and redirects resolved. Pure.
- `policy.ts` - `.forger/hooks.json`: the default rules, a project's own deny
  rules, and the defaults a policy drops. Pure.
- `decide.ts` - the worker's and the supervisor's decision over a tool call.
  Pure.

## Entry point

`index.ts`. The `hook` command in `cli/` reads the harness's call, the facts
and the policy, and writes a refusal to the event file as `worker_denied`.

## May import

Nothing outside this folder.
