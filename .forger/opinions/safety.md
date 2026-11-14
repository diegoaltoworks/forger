# Safety opinions

What the safety pack holds, and why. A rule marked "check" is enforced by
`check safety`; the rest are judgement, kept by whoever writes the code.

## No secrets in the repo (check: safety.secrets)

A committed secret is leaked for good: history, forks and caches keep it after
the file is fixed. `check safety` reads the lines the branch adds, plus untracked
files, and matches them against the shapes of known credentials (private keys,
cloud and source-host tokens, payment and AI-service keys). An added `.env` file
fails too; `.env.example` and its sample and template variants are meant to be
committed. The finding names the file, line and pattern and never prints the
match, so the report itself does not spread the secret. A leaked secret is
rotated first and removed second.

## Stored data is carried forward (check: safety.data-forward)

Data in production is sacred. A change to a stored shape must carry every
stored record forward, and the proof is a test. `.forger/safety.json` lists the
`migration_paths` that define stored shapes and the `data_test_paths` where the
proof lives; a diff that touches the first without touching the second fails.
Rewrite both lists to match your tree. Prefer expand, migrate, contract over one
step that changes a shape in place.

## Dependencies are audited (check: safety.dependency-audit)

A dependency with a known vulnerability is a risk the project inherits.
`.forger/safety.json` may name an `audit_command`, the project's own audit; the
flags on that command choose the severity it fails at. `check safety` runs it
and a non-zero exit is one finding carrying the end of the output. A command
that cannot start is a finding too, never a pass. With no `audit_command` the
check reads `unmeasured`: it informs, it does not fail. The audit needs the
network, so it runs in `check`, not in unit tests. Examples:

- npm: `"audit_command": "npm audit --audit-level=high"`
- Python: `"audit_command": "pip-audit"`

## Access is reviewed (template: safety.access-reviewed)

No check can decide who may read or change whose data; it takes a reviewer who
reads the whole app. Set `access_review.every_merged` in `.forger/safety.json`
and the loop files one access review after that many merges, from the template
in `.forger/templates/access-review.md`, unless one is still open. The reviewer
lists every route, handler or command that touches stored data, says whose data
it is, names the test that shows another person is refused, and files a ticket
for each missing test or missing refusal. `0`, or leaving it out, is off.

## Lockfiles are frozen in the gates

The gates install with the frozen-lockfile flag of your dependency installer, so a
dependency never changes underneath a green run. A lockfile that would change is
a failed gate, fixed by committing the lockfile deliberately.

## Destructive commands are listed

The project's `process.md` gotchas list every command that destroys data (drops,
truncates, force pushes, recursive deletes) and say who may run it and where.
An unlisted destructive command is not run.
