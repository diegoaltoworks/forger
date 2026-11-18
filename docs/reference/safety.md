# Safety

What keeps an unattended worker within bounds.

## Safety

The worker runs headless with `--dangerously-skip-permissions`. Keep the repo's
data-safety and write-scope rules in `.forger/process.md` explicit and enforced
by tests, not convention - the loop will do exactly what the backlog tells it to.

## The tracker's site is not the worker's

With the tracker kind `jira`, the worker's hook has one more rule, `tracker-site`.
A command that names the configured site's host, or the vendor's gateway host,
is refused with a message that points at `work ticket <n>`; the engine reads and
moves the issues. The rule is on for every worker whatever `.forger/hooks.json`
says, and with the other kinds it refuses nothing. The engine's own calls are
not a worker's and are not judged by it. With this kind a pull request's title
begins with the issue's key and its body holds no closing reference: `verify`
and `merge` refuse one.

## A session stays in its own folder

The worker's hook refuses a `cd` or a write in the loop's checkout outside the
worker's worktree. A verifier is started by a worker's `verify` call, and its
own folder is its copy of the pull request: it may `cd` into that copy and
write there, and nowhere else in the loop's checkout. A worker is still refused
in every verify copy.

## Guards hold

A guarantee (a coverage floor, a budget, a threshold, a test) is the owner's to
change, not the worker's. `check guards` runs with the other gates and fails a
diff that lowers a minimum, raises a maximum, changes a number whose direction
the key name does not give, deletes a guard or test file, or adds a skip to a
test. The owner records the change with `decide <n>`; naming the file in the
ticket's Decisions section lets that file through.

## Access is reviewed

No check can decide who may read or change whose data. With the safety pack, set
`access_review.every_merged` in `.forger/safety.json` and the loop files one
access review after that many merges, unless one is still open. The reviewer
lists every route, handler or command that touches stored data, whose data it
is, and the test that shows another person is refused, then files a ticket per
missing test or refusal. `0`, or leaving it out, is off. The opinion is
`safety.access-reviewed`.
