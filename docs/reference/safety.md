# Safety

What keeps an unattended worker within bounds.

## Safety

The worker runs headless with `--dangerously-skip-permissions`. Keep the repo's
data-safety and write-scope rules in `.forger/process.md` explicit and enforced
by tests, not convention - the loop will do exactly what the backlog tells it to.

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
