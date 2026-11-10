/**
 * A stop that belongs to one ticket sets that ticket aside (ADR 0020). Pure:
 * how a run of set-asides is kept, when it halts the loop, and which tickets
 * the next pick must skip.
 */

import type {Footprint} from '../../backlog';

/** One ticket set aside in this run, kept in the loop state so the pick and the report can name it. */
export interface SetAsideEntry {
  ticket: string;
  reason: string;
  iteration: number;
  /** What the ticket declared it touches; null when it declared nothing. */
  footprint: Footprint | null;
}

export interface SetAsideUpdate {
  set_aside_tasks: SetAsideEntry[];
  consecutive_set_asides: number;
  /** Why the loop halts; null while the run of set-asides is short enough. */
  halt: string | null;
}

/**
 * Fold one finished run in. A set-aside extends the run; only a merge ends it,
 * since any other outcome says nothing about whether the tickets were the cause.
 * The loop halts when the run reaches `max`.
 */
export function setAsideUpdate(history: SetAsideEntry[], consecutive: number, aside: SetAsideEntry | null, merged: boolean, max: number): SetAsideUpdate {
  if (merged) return {set_aside_tasks: history, consecutive_set_asides: 0, halt: null};
  if (!aside) return {set_aside_tasks: history, consecutive_set_asides: consecutive, halt: null};
  const set_aside_tasks = [...history.filter(h => h.ticket !== aside.ticket), aside];
  const consecutive_set_asides = consecutive + 1;
  if (consecutive_set_asides < max) return {set_aside_tasks, consecutive_set_asides, halt: null};
  const run = set_aside_tasks.slice(-consecutive_set_asides).map(e => e.ticket);
  return {
    set_aside_tasks,
    consecutive_set_asides,
    halt: `Set aside ${consecutive_set_asides} tickets in a row with no merge between them: ${run.join(', ')}. The cause is unlikely to be the tickets; look at the reasons, then resume.`,
  };
}

/** The footprints the next pick must not share with: those of the tickets set aside. */
export function avoidedFootprints(history: SetAsideEntry[]): Footprint[] {
  return history.flatMap(e => (e.footprint ? [e.footprint] : []));
}
