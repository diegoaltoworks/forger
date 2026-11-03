/**
 * Reading the verdict records `verify` writes (ADR 0010), for the two readers
 * that act on them: `merge`, which refuses without a passing one, and the
 * engine, which tells a verified merge from an unverified one.
 */

import {existsSync, readdirSync, readFileSync} from 'fs';
import {join} from 'path';

import type {Decision} from './verdict';
import type {VerdictRecord} from './verify-input';

/** Every readable record kept for a PR, whatever head it was made at. */
export function readVerdicts(dir: string, pr: number): VerdictRecord[] {
  if (!existsSync(dir)) return [];
  const prefix = `pr-${pr}-`;
  const records: VerdictRecord[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(prefix) || !name.endsWith('.json')) continue;
    try {
      const r = JSON.parse(readFileSync(join(dir, name), 'utf-8')) as VerdictRecord;
      if (r && r.pr === pr && typeof r.head === 'string') records.push(r);
    } catch {
      // an unreadable record counts as no record
    }
  }
  return records;
}

/** The decision recorded for exactly this head; null when there is none (a record for an older head is stale). */
export function decisionForHead(records: VerdictRecord[], head: string | null): Decision | null {
  if (!head) return null;
  return records.find(r => r.head === head)?.decision ?? null;
}

/** Why a PR may not merge on its verdicts; null when its head has a passing one. */
export function verdictRefusal(records: VerdictRecord[], head: string | null): string | null {
  if (!head) return 'cannot tell the PR head, so no verdict can be matched to it';
  const record = records.find(r => r.head === head);
  if (!record) {
    return records.length > 0
      ? `the verdict is stale: it was made for an earlier head, not ${head.slice(0, 7)}; run verify again`
      : 'no verdict recorded for the PR head; run verify first';
  }
  if (record.decision === 'pass') return null;
  const open = record.entries.filter(e => e.verdict !== 'met');
  const named = open.map(e => `${e.criterion} (${e.verdict})`).join(', ') || 'none named';
  const why = record.decision === 'block' ? 'the verdict blocks the merge' : 'the verdict is unclear and blocks the merge';
  return `${why}; criteria not met: ${named}`;
}
