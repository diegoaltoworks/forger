# Delivery opinions

What the delivery pack holds, and why. A merge says the code is green, not that
the delivered build works. The project names its own commands for what happens
after the merge; forger runs them and holds no deploy logic or credentials.

## A delivery is checked (check: delivery.checked-after-merge)

`.forger/deliver.json` has a `check`: a command that exits 0 when the delivered
build works, typically the journeys run against the delivered address. It may
also have a `deploy` and a `rollback`. `timeout_seconds` is an object keyed by
step (`deploy`, `check`, `rollback`) of positive numbers. `check delivery`
validates the file and runs none of the commands.

## The commands are the project's own (rule: delivery.project-commands)

Credentials and deploy logic stay in the project's scripts and its secret
store. After each merge the engine runs deploy and check in the main checkout,
records `delivered` or `delivery_failed`, and on a failure files a `P0` issue
(or comments on the open one) and runs the rollback when one is configured. A
failed delivery does not halt the loop; a failed rollback does. When a check fails after a merge, the plan runs the rollback only when
one is configured; with none, nothing is reverted.
