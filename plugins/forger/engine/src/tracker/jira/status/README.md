# tracker/jira/status

What the engine does to an issue's status, as decisions the adapter applies.

## Files

- `moves.ts` - the pure decisions of a status move.
- `wantedStatus` - the status an event moves an issue to, if any.
- `moveTo` - the transition that leads to a status, or a line to log.
- `mergedWrites` - what a merge writes when no done status exists.

## May import

Its own types, the config's settings types and the port's types.
