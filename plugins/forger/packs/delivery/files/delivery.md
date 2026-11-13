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

## A smoke check

A project that wants a plain smoke check can copy this `check` command. It is a
script the project owns, for example `scripts/smoke.sh`, named in `deliver.json`:

```sh
#!/bin/sh
# Usage: smoke.sh <base-url> <expected-commit> <path>...
base="$1"; want="$2"; shift 2

# Wait until the delivered address reports the merged commit. The engine
# ends the step at timeout_seconds.check, so the loop needs no clock of its own.
until [ "$(curl -fsS "$base/version" 2>/dev/null)" = "$want" ]; do
  sleep 5
done

# Request each public address; any status outside 2xx fails the check.
status=0
for path in "$@"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$base$path")
  case "$code" in
    2??) ;;
    *) echo "FAIL $base$path $code"; status=1 ;;
  esac
done
exit $status
```

The `/version` address and the list of public paths are the project's own;
forger keeps no address list. When the check exits non-zero, or runs past
`timeout_seconds.check`, the delivery has failed: forger files a `P0` issue
that links the merged PR, and runs the `rollback` when one is configured.
