# Journeys opinions

What the journeys pack holds, and why. Units and screens can all pass while the
app cannot do the thing it is for. A journey names one thing a person must be
able to do, from start to finish, and a command that proves it.

## Journeys are named (check: journeys.named)

`.forger/journeys.json` lists the `journeys`. Each has a `name`, a `command` and
the `paths` (globs) of the code it runs through. With none named, `check
journeys` reads unmeasured: an app whose purpose is unwritten has not passed.
Start with the two or three things the app exists for.

## Journeys pass (check: journeys.pass)

`command` exercises the journey against a running build and exits non-zero when
it fails. The finding names the journey and the end of its output. The optional
`start` command brings the app up for the whole run, `ready` exits 0 once it is
up (polled for up to `ready_seconds`), and the app is stopped afterwards even
when a journey fails.

## Guards

A ticket that touches a journey's `paths` names the journey under Guards.
`facts --guards <path>...` lists the journeys whose paths match.
