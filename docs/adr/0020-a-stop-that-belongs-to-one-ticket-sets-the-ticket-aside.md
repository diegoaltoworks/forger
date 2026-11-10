# A stop that belongs to one ticket sets the ticket aside

Status: Accepted

The owner agreed that the loop may set a ticket aside and continue when the cause belongs to that ticket.

## Context

A worker's `stop` halted the whole loop, whatever its cause. A ticket that needed a decision, or hit a conflict between a design rule and a guarantee, held back every ticket that had nothing to do with it, and `resume` needed the owner. The engine already set a ticket aside without halting in two cases: a decline on the record and a failed probe.

## Decision

A worker's `stop` no longer halts. This holds for a plain stop, for `stop conflict`, and for the stop that follows `handover` when the verifier's rounds run out. The engine:

- labels the issue `needs-human` and posts the reason, or the options for a conflict (a ticket `handover` already labelled and commented is not commented again);
- records a `set_aside` event with the ticket and the reason;
- picks again, skipping the ticket's dependants (the tracker already blocks them) and every ticket that shares a footprint with a ticket set aside in this run.

The loop still halts for a cause that is not one ticket's: an infrastructure error, a merge on red checks, an unverified merge, a backlog entry that reads completed with nothing merged, too many failures in a row, a stall.

`limits.maxSetAside` bounds the run. That many set-asides in a row, with no merge between them, halt the loop, since the cause is then unlikely to be the tickets. A merge resets the count; `resume` clears it.

`set_aside` is a recorded event, not a terminal one, so a watcher does not wake on it. `report` lists each ticket set aside under "waiting on you" with its reason. `decide <n>` on such a ticket removes `needs-human` and restores the intake label, so the next pick can take it.

## Consequences

- One ticket's stop costs one ticket, not the run.
- A cause outside the tickets can look like several stops. The `maxSetAside` bound turns that into a halt after a few, not after the whole backlog.
- The footprint skip keeps the loop from building on ground a stopped ticket left unsettled. A ticket that declares no footprint is not skipped.
