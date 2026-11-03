# Forger

An unattended development loop for Claude Code: tickets are built one at a time
by headless workers, watched by a supervisor working with the owner, and the
process is refined from every correction and failure.

## People and roles

**Owner**:
The person the work is for; the only one who decides anything hard to undo.
_Avoid_: user, human, client

**Supervisor**:
The interactive session that works with the owner: intake, ordering, dispatch, watching, verifying, reporting, refining.
_Avoid_: manager, orchestrator

**Engine**:
The detached runner that picks the next ticket, starts one worker, enforces the budget and halts on trouble.
_Avoid_: runner, loop (when meaning the process itself)

**Worker**:
A headless session that builds exactly one ticket, from branch to merged PR.
_Avoid_: agent, coder

## Work

**Ticket**:
One vertical slice of work, sized to one worker, with acceptance criteria.
_Avoid_: feature, PRD feature, task, story

**Backlog**:
The set of tickets and their statuses that the engine selects from.
_Avoid_: PRD, queue

**Work order**:
The owner's current priority, written by the supervisor, read by every worker first.
_Avoid_: inbox, brief
