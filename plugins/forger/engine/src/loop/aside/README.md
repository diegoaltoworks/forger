# aside

A worker's stop sets its ticket aside and the loop goes on (ADR 0020).

## Files

- `track.ts` - keeps the tickets set aside in this run. It counts them in a
  row, halts the loop at `limits.maxSetAside`, and gives the footprints the
  next pick must skip. Pure.
- `reasons.ts` - reads the reason for each ticket set aside from the events.
  It builds the comment and the commands that return an answered ticket to the
  Backlog. Pure.
- `hand-over.ts` - labels the issue `needs-human` and posts the reason through
  the injected command port. It returns the problems it met and does not throw.
