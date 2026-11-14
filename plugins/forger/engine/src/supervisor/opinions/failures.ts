/**
 * How often each installed opinion with a check fails, and how those failures
 * end. Pure; the CLI reads the records file, the packs and the tracker.
 */

/** The fields of a check record this report reads; extra fields are ignored. */
export interface FailureRecord {
  ticket: string;
  opinion?: string;
  failed: number;
  waived: number;
  clean?: true;
}

export interface CheckedOpinion {
  id: string;
}

export interface OpinionFailures {
  opinion: string;
  runs_failed: number;
  tickets_failed: number;
  ended_fixed: number;
  ended_waived: number;
  ended_open: number;
  never_failed: boolean;
}

/** `records` are in the order they were written; the last one of a ticket is its latest run. */
export function computeOpinionFailures(records: FailureRecord[], opinions: CheckedOpinion[], merged: ReadonlySet<string>): OpinionFailures[] {
  const byTicket = new Map<string, FailureRecord[]>();
  for (const r of records) byTicket.set(r.ticket, [...(byTicket.get(r.ticket) ?? []), r]);
  const rows = opinions.map((o): OpinionFailures => {
    const row: OpinionFailures = {opinion: o.id, runs_failed: 0, tickets_failed: 0, ended_fixed: 0, ended_waived: 0, ended_open: 0, never_failed: !records.some(r => r.opinion === o.id)};
    for (const [ticket, runs] of byTicket) {
      const failedRuns = runs.filter(r => r.opinion === o.id && r.failed > 0).length;
      if (failedRuns === 0) continue;
      row.runs_failed += failedRuns;
      row.tickets_failed += 1;
      const lastForOpinion = runs.filter(r => r.opinion === o.id).at(-1);
      if (runs.at(-1)?.clean === true && merged.has(ticket)) row.ended_fixed += 1;
      else if (lastForOpinion !== undefined && lastForOpinion.failed === 0 && lastForOpinion.waived > 0) row.ended_waived += 1;
      else row.ended_open += 1;
    }
    return row;
  });
  return rows.sort((a, b) => Number(a.never_failed) - Number(b.never_failed) || b.tickets_failed - a.tickets_failed || b.runs_failed - a.runs_failed || a.opinion.localeCompare(b.opinion));
}

export function formatOpinionFailures(rows: OpinionFailures[]): string {
  const failed = rows.filter(r => !r.never_failed).map(r => `${r.opinion}: ${r.runs_failed} run(s) failed on ${r.tickets_failed} ticket(s); ${r.ended_fixed} fixed, ${r.ended_waived} waived, ${r.ended_open} open`);
  const never = rows.filter(r => r.never_failed).map(r => r.opinion);
  return [...failed, ...(never.length > 0 ? [`never failed: ${never.join(', ')}`] : [])].join('\n');
}
