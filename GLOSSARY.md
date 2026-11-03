# Forger

An unattended development loop for any model and harness: tickets are built one at a time
by headless workers, watched by a supervisor working with the owner, and the
process is refined from every correction and failure.

## People and roles

**Owner**:
The person the work is for; the only one who decides anything hard to undo.
_Avoid_: user (when meaning the owner), human (when meaning the owner), client

**Supervisor**:
The interactive session that works with the owner: intake, ordering, dispatch, watching, verifying, reporting, refining.
_Avoid_: manager, orchestrator

**Engine**:
The detached runner that picks the next ticket, starts one worker, enforces the budget and halts on trouble.
_Avoid_: runner, loop (when meaning the process itself)

**Worker**:
A headless session that builds exactly one ticket, from branch to merged PR.
_Avoid_: agent (when meaning the worker), coder

## Work

**Ticket**:
One vertical slice of work, sized to one worker, with acceptance criteria.
_Avoid_: feature (when meaning a ticket), PRD feature, task (when meaning a ticket), story

**Backlog**:
The set of tickets and their statuses that the engine selects from.
_Avoid_: PRD, queue

**Work order**:
The owner's current priority, written by the supervisor, read by every worker first.
_Avoid_: inbox, brief

**Skill slot**:
A named point where a model does judgement work, with a built-in forger step that an installed skill can replace through the `skills` section of the config.
_Avoid_: hook (when meaning a skill slot), plugin point

**Opinion**:
One rule forger holds about how the work is done, with an id, the why, a rung on the refinement ladder and, when it has one, the check that enforces it.
_Avoid_: preference, guideline

**Pack**:
A named, versioned set of opinions with the files and checks that carry them, installed into a project by `setup` and recorded in the lock.
_Avoid_: bundle, module

**Lock**:
`.forger/forger.lock.json`: each installed pack's id and version and the hash of every file as it was installed. Written by `setup`, never by hand.
_Avoid_: manifest (that is the pack's own file)
