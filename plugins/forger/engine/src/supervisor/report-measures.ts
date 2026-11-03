/**
 * The owner's view of the measures (ADR 0013): cost per merged ticket, rework
 * rate, escaped defects and owner interventions. Pure over `Measures`; the rest
 * of `measure` stays for the retro.
 */

import type {Measures} from './measure';

export interface ReportMeasures {
  /** Mean spend over the tickets whose cost is known; null when none is. */
  cost_per_merged_ticket_usd: number | null;
  /** Tickets whose cost is unknown, so the mean above does not cover them. */
  cost_unknown_tickets: number;
  merged_prs: number | null;
  /** Share of merged PRs reworked inside the window; null when the tracker could not be read. */
  rework_rate: number | null;
  escaped_defects: number | null;
  owner_interventions: {total: number; by_event: Record<string, number>};
}

export function buildReportMeasures(m: Measures): ReportMeasures {
  const known = m.tickets.filter(t => t.cost_usd !== null);
  const spent = known.reduce((a, t) => a + (t.cost_usd as number), 0);
  const c = m.change_rework;
  return {
    cost_per_merged_ticket_usd: known.length === 0 ? null : spent / known.length,
    cost_unknown_tickets: m.tickets.length - known.length,
    merged_prs: c === null ? null : c.merged,
    rework_rate: c === null ? null : c.rework_rate,
    escaped_defects: c === null ? null : c.escaped_defects.length,
    owner_interventions: {total: m.owner_interventions.total, by_event: {...m.owner_interventions.by_event}},
  };
}

export function formatReportMeasures(r: ReportMeasures): string[] {
  const pct = (s: number | null) => (s === null ? 'unknown' : `${Math.round(s * 100)}%`);
  const events = Object.entries(r.owner_interventions.by_event).map(([k, n]) => `${k} ${n}`);
  const cost = r.cost_per_merged_ticket_usd === null ? 'unknown' : `$${r.cost_per_merged_ticket_usd.toFixed(2)}`;
  const unknown = r.cost_unknown_tickets > 0 ? ` (${r.cost_unknown_tickets} ticket(s) without a known cost)` : '';
  return [
    `- cost per merged ticket: ${cost}${unknown}`,
    `- rework rate: ${pct(r.rework_rate)}`,
    `- escaped defects: ${r.escaped_defects ?? 'unknown'}`,
    `- owner interventions: ${r.owner_interventions.total}${events.length > 0 ? ` (${events.join(', ')})` : ''}`,
  ];
}
