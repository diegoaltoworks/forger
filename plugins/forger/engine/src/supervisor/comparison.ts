/**
 * The comparison report of ADR 0012: the five measures that make a run over a
 * fixed request set evidence, as one JSON document, and the diff of two such
 * documents. Pure; `measure` gathers the inputs.
 */

import type {Measures} from './measure';

export interface ComparisonReport {
  tickets_merged: number;
  failure_causes: Record<string, number>;
  /** Budget lines over merged tickets; null when nothing merged or no budget was recorded. */
  cost_per_merged_ticket: number | null;
  rework: {ci_extra_rounds: number; blocked_prs: number; rerun_after_conflict: number; redone_tickets: number};
  owner_interventions: {total: number | null; by_event: Record<string, number>; unknown_reason?: string};
}

export interface Delta {
  a: number | null;
  b: number | null;
  /** b minus a; null when either side is unknown. */
  delta: number | null;
}

export interface ReportDiff {
  tickets_merged: Delta;
  failure_causes: Record<string, Delta>;
  cost_per_merged_ticket: Delta;
  rework: Record<keyof ComparisonReport['rework'], Delta>;
  owner_interventions: {total: Delta; by_event: Record<string, Delta>};
}

export function buildComparisonReport(m: Measures): ComparisonReport {
  const budgeted = m.tickets.filter(t => t.budget_cap_usd !== null);
  const budget = budgeted.reduce((a, t) => a + (t.budget_cap_usd as number), 0);
  return {
    tickets_merged: m.merged.tickets,
    failure_causes: {...m.runs.by_cause},
    cost_per_merged_ticket: m.merged.tickets === 0 || budgeted.length === 0 ? null : budget / m.merged.tickets,
    rework: {
      ci_extra_rounds: m.tickets.reduce((a, t) => a + Math.max((t.ci_rounds ?? 1) - 1, 0), 0),
      blocked_prs: m.verification.blocked,
      rerun_after_conflict: m.parallel.rework.rerun_after_conflict,
      redone_tickets: m.rework.redone_tickets,
    },
    owner_interventions:
      m.interventions_unknown === null
        ? {total: m.owner_interventions.total, by_event: {...m.owner_interventions.by_event}}
        : {total: null, by_event: {}, unknown_reason: m.interventions_unknown},
  };
}

function delta(a: number | null | undefined, b: number | null | undefined): Delta {
  const x = a ?? null;
  const y = b ?? null;
  return {a: x, b: y, delta: x === null || y === null ? null : y - x};
}

/** Counts keyed by name; a key missing on one side reads as zero. */
function deltaMap(a: Record<string, number>, b: Record<string, number>): Record<string, Delta> {
  const out: Record<string, Delta> = {};
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) out[k] = delta(a[k] ?? 0, b[k] ?? 0);
  return out;
}

/** Per-measure delta from report `a` (the baseline) to report `b`. */
export function diffReports(a: ComparisonReport, b: ComparisonReport): ReportDiff {
  const keys = ['ci_extra_rounds', 'blocked_prs', 'rerun_after_conflict', 'redone_tickets'] as const;
  return {
    tickets_merged: delta(a.tickets_merged, b.tickets_merged),
    failure_causes: deltaMap(a.failure_causes, b.failure_causes),
    cost_per_merged_ticket: delta(a.cost_per_merged_ticket, b.cost_per_merged_ticket),
    rework: Object.fromEntries(keys.map(k => [k, delta(a.rework[k], b.rework[k])])) as ReportDiff['rework'],
    owner_interventions: {
      total: delta(a.owner_interventions.total, b.owner_interventions.total),
      by_event: deltaMap(a.owner_interventions.by_event, b.owner_interventions.by_event),
    },
  };
}
