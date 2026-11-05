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
_Avoid_: inbox

**Creative intent**:
A planning request about how something looks, feels or plays rather than what it does, found by `work intent` from the request text and the repo's dependencies.

**Brief**:
The owner's creative request, recorded verbatim at the top of the plan doc. Later steps judge the work against it.

**Reference**:
A work the owner names as a touchstone ("think <X>", "in the style of"). It is read as intent (feel, charm, readability), never as a spec to copy, and the plan states how it was read.

**Prototype**:
A throwaway single-file concept built before tickets on creative work, so the owner reacts to something real. Two or three are built, differing on the axis the brief leaves open; the chosen one is archived under `docs/progress/` as the reference and is never merged into the product source.

**Critique**:
A fresh-context look at a visual change against the owner's verbatim brief, after the ticket's own criteria have passed. It scores named dimensions and ranks findings phrased as proposed tickets; findings above a threshold are filed, and a critique never blocks a merge.

**Skill slot**:
A named point where a model does judgement work, with a built-in forger step that an installed skill can replace through the `skills` section of the config.
_Avoid_: hook (when meaning a skill slot), plugin point

**Flavour**:
A named, versioned selection over the skill slots: per slot an ordered list of candidates, with the built-in step as the implicit last one. The config picks one by `name@version`; the `skills` map still wins per slot.

**Candidate**:
One skill or file a flavour offers for a slot, with optional conditions on the ticket (labels, paths, installed packs). The first candidate whose conditions hold and which is installed wins.

**Collection**:
An installed set of third-party skills, such as agent-skills, mattpocock-skills or pstack, that a flavour maps onto the skill slots. Forger takes a collection's skills and never its routers or loops.

**Preset**:
Another name for a shipped flavour that maps one collection; `setup --preset <name>` is `setup --flavour <name>`.

**File slot**:
A slot filled by reading a skill's `SKILL.md` and following it, instead of invoking the skill by name. Used for skills that refuse model invocation or that a human invokes.

**Opinion**:
One rule forger holds about how the work is done, with an id, the why, a rung on the refinement ladder and, when it has one, the check that enforces it.
_Avoid_: preference, guideline

**Pack**:
A named, versioned set of opinions with the files and checks that carry them, installed into a project by `setup` and recorded in the lock.
_Avoid_: bundle, module

**Lock**:
`.forger/forger.lock.json`: each installed pack's id and version and the hash of every file as it was installed. Written by `setup`, never by hand.
_Avoid_: manifest (that is the pack's own file)

**Hook policy**:
`.forger/hooks.json`: the boundaries the harness hook enforces on a worker. The default rules ship on and a project may add deny rules of its own; a dropped default needs a waiver.
_Avoid_: guard list, blocklist
