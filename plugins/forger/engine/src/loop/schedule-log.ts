/**
 * The scheduling-decision file: one JSON line per pair of tickets the rule
 * judged while workers ran side by side, so the measures can read how often
 * the rule says `serial`. Append-only, like the event file.
 */

import {appendFileSync, existsSync, readFileSync} from 'fs';

export interface ScheduleRecord {
  at: string;
  ticket: string;
  /** The running ticket the candidate was judged against. */
  other: string;
  verdict: 'parallel' | 'serial';
  reason: string;
}

export function scheduleLine(r: ScheduleRecord): string {
  return `${JSON.stringify(r)}\n`;
}

export function appendSchedule(file: string, r: ScheduleRecord): void {
  appendFileSync(file, scheduleLine(r));
}

export function parseSchedule(text: string): ScheduleRecord[] {
  const out: ScheduleRecord[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const r = JSON.parse(line) as ScheduleRecord;
      if (typeof r.ticket === 'string' && typeof r.other === 'string' && (r.verdict === 'parallel' || r.verdict === 'serial')) out.push(r);
    } catch {
      // A torn line is not a record.
    }
  }
  return out;
}

export function readSchedule(file: string): ScheduleRecord[] {
  return existsSync(file) ? parseSchedule(readFileSync(file, 'utf-8')) : [];
}
