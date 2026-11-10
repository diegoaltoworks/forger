import type {CheckReport} from '../checks';

/** One opinion's result in one `check` run; `clean` marks a run with no finding at all. */
export interface CheckRecord {
  at: string;
  ticket: string;
  iteration: number;
  opinion?: string;
  check?: string;
  failed: number;
  waived: number;
  clean?: true;
}

export interface RecordContext {
  at: string;
  ticket: string;
  iteration: number;
}

/** Pure: one record per (check, opinion) that has a finding, or a single clean record. */
export function recordsFromReport(report: CheckReport, ctx: RecordContext): CheckRecord[] {
  const counts = new Map<string, CheckRecord>();
  const bump = (check: string, opinion: string, key: 'failed' | 'waived') => {
    const id = `${check}\0${opinion}`;
    const rec = counts.get(id) ?? {...ctx, opinion, check, failed: 0, waived: 0};
    rec[key] += 1;
    counts.set(id, rec);
  };
  for (const r of report.results) {
    for (const v of r.violations) bump(r.check, v.opinion, 'failed');
    for (const w of r.waived) bump(r.check, w.opinion, 'waived');
  }
  return counts.size === 0 ? [{...ctx, failed: 0, waived: 0, clean: true}] : [...counts.values()];
}
