/**
 * What running workers side by side bought and cost (ADR 0011), computed from
 * the iteration logs and the scheduling-decision file. Pure.
 */

import type {ScheduleRecord} from '../loop';

/** The part of an iteration record these measures read. */
export interface RunFact {
  ticket: string | null;
  iteration: number;
  elapsedSeconds: number;
  status: string | null;
  /** Start time (ISO); null in a log written before it was recorded. */
  startedAt: string | null;
  /** The parallelism setting in force; null in a log written before it was recorded. */
  parallelism: number | null;
}

export interface ParallelismRate {
  parallelism: number;
  merges: number;
  wall_seconds: number;
  merges_per_hour: number;
}

export interface ParallelMeasures {
  by_parallelism: ParallelismRate[];
  conflicts: {
    conflicted: number;
    /** Conflicted runs over runs that merged or conflicted; 0 when there are none. */
    rate: number;
    /** Tickets that ran while a conflicted ticket ran, as ticket pairs. */
    pairs: Array<[string, string]>;
  };
  rework: {rerun_after_conflict: number};
  verdicts: {parallel: number; serial: number; serial_share: number; by_reason: Record<string, number>};
}

interface Span {
  start: number;
  end: number;
}

function span(r: RunFact): Span | null {
  if (r.startedAt === null) return null;
  const start = Date.parse(r.startedAt);
  return Number.isNaN(start) ? null : {start, end: start + r.elapsedSeconds * 1000};
}

/** Seconds covered by at least one span, so overlapping workers count the wall clock once. */
function unionSeconds(spans: Span[]): number {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let total = 0;
  let cursor = -Infinity;
  for (const s of sorted) {
    const from = Math.max(s.start, cursor);
    if (s.end > from) total += s.end - from;
    cursor = Math.max(cursor, s.end);
  }
  return total / 1000;
}

function ratesByParallelism(runs: RunFact[]): ParallelismRate[] {
  const groups = new Map<number, RunFact[]>();
  for (const r of runs) {
    // A log from before the setting existed was one worker at a time.
    const p = r.parallelism ?? 1;
    groups.set(p, [...(groups.get(p) ?? []), r]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([parallelism, group]) => {
      const spans = group.map(span);
      const wall = spans.every(s => s !== null)
        ? unionSeconds(spans as Span[])
        : group.reduce((a, r) => a + r.elapsedSeconds, 0);
      const merges = group.filter(r => r.status === 'completed').length;
      return {parallelism, merges, wall_seconds: Math.round(wall), merges_per_hour: wall === 0 ? 0 : (merges * 3600) / wall};
    });
}

function conflictPairs(runs: RunFact[]): Array<[string, string]> {
  const out = new Map<string, [string, string]>();
  for (const c of runs.filter(r => r.status === 'conflict' && r.ticket !== null)) {
    const cs = span(c);
    if (cs === null) continue;
    for (const o of runs) {
      const os = span(o);
      if (o === c || o.ticket === null || o.ticket === c.ticket || os === null) continue;
      if (os.start < cs.end && cs.start < os.end) {
        const pair = [c.ticket as string, o.ticket].sort() as [string, string];
        out.set(pair.join('|'), pair);
      }
    }
  }
  return [...out.values()];
}

export function computeParallelMeasures(runs: RunFact[], decisions: ScheduleRecord[]): ParallelMeasures {
  const ordered = [...runs].sort((a, b) => a.iteration - b.iteration);
  const conflicted = ordered.filter(r => r.status === 'conflict').length;
  const settled = ordered.filter(r => r.status === 'completed' || r.status === 'conflict').length;

  const seenConflict = new Set<string>();
  let rerun = 0;
  for (const r of ordered) {
    if (r.ticket === null) continue;
    if (seenConflict.has(r.ticket)) {
      rerun += 1;
      seenConflict.delete(r.ticket);
    }
    if (r.status === 'conflict') seenConflict.add(r.ticket);
  }

  const byReason: Record<string, number> = {};
  let serial = 0;
  for (const d of decisions) {
    byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
    if (d.verdict === 'serial') serial += 1;
  }
  return {
    by_parallelism: ratesByParallelism(ordered),
    conflicts: {conflicted, rate: settled === 0 ? 0 : conflicted / settled, pairs: conflictPairs(ordered)},
    rework: {rerun_after_conflict: rerun},
    verdicts: {parallel: decisions.length - serial, serial, serial_share: decisions.length === 0 ? 0 : serial / decisions.length, by_reason: byReason},
  };
}
