/**
 * Bounding the verify loop (ADR 0010): from the verdict records of a PR, decide
 * whether to merge, fix and verify again, or hand the ticket to the owner. Pure;
 * the tracker calls live in handover-io.ts.
 */

import type {VerdictRecord} from './verify-input';

export type VerifyMove =
  | {move: 'merge'}
  | {move: 'fix'; round: number; remaining: number; open: OpenCriterion[]}
  | {move: 'hand_over'; rounds: number; open: OpenCriterion[]; reword: string[]};

export interface OpenCriterion {
  criterion: string;
  verdict: 'not_met' | 'cannot_tell';
}

/** Records in the order they were made. */
function inOrder(records: VerdictRecord[]): VerdictRecord[] {
  return [...records].sort((a, b) => a.at.localeCompare(b.at));
}

function openOf(record: VerdictRecord): OpenCriterion[] {
  return record.entries
    .filter(e => e.verdict !== 'met')
    .map(e => ({criterion: e.criterion, verdict: e.verdict as OpenCriterion['verdict']}));
}

/** Criteria that were `cannot_tell` in at least two rounds: the owner should reword them or make them mechanical. */
export function repeatedCannotTell(records: VerdictRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    for (const e of r.entries) if (e.verdict === 'cannot_tell') counts.set(e.criterion, (counts.get(e.criterion) ?? 0) + 1);
  }
  return [...counts].filter(([, n]) => n >= 2).map(([c]) => c);
}

/**
 * The next move for a PR. A round is one record (one verified head). A passing
 * latest record merges; otherwise there is a fix while rounds remain, and a
 * hand-over once `maxRounds` have been spent. No record at all is a first
 * round still to run, reported as a fix with nothing open.
 */
export function nextMove(records: VerdictRecord[], maxRounds: number): VerifyMove {
  const ordered = inOrder(records);
  const latest = ordered[ordered.length - 1];
  if (!latest) return {move: 'fix', round: 1, remaining: maxRounds, open: []};
  if (latest.decision === 'pass') return {move: 'merge'};
  const open = openOf(latest);
  if (ordered.length >= maxRounds) {
    return {move: 'hand_over', rounds: ordered.length, open, reword: repeatedCannotTell(ordered)};
  }
  return {move: 'fix', round: ordered.length + 1, remaining: maxRounds - ordered.length, open};
}

export interface HandedOver {
  ticket: string;
  pr: number;
  rounds: number;
  open: OpenCriterion[];
  reword: string[];
}

/** Tickets whose verification ran out of rounds without a pass, for the loop report. */
export function handedOver(records: VerdictRecord[], maxRounds: number): HandedOver[] {
  const byPr = new Map<number, VerdictRecord[]>();
  for (const r of records) byPr.set(r.pr, [...(byPr.get(r.pr) ?? []), r]);
  const out: HandedOver[] = [];
  for (const [pr, rs] of byPr) {
    const m = nextMove(rs, maxRounds);
    if (m.move === 'hand_over') out.push({ticket: rs[0].ticket, pr, rounds: m.rounds, open: m.open, reword: m.reword});
  }
  return out.sort((a, b) => a.pr - b.pr);
}

/** The comment left on the issue; names each unmet or unclear criterion with its text. */
export function handoverComment(h: HandedOver, texts: Record<string, string>): string {
  const line = (o: OpenCriterion) => `- ${o.criterion} (${o.verdict}): ${texts[o.criterion] ?? ''}`.trimEnd();
  const parts = [
    `Verification of PR #${h.pr} did not pass in ${h.rounds} rounds, so the loop is handing this ticket to the owner.`,
    '',
    'Criteria not met or unclear:',
    ...h.open.map(line),
  ];
  if (h.reword.length > 0) {
    parts.push('', `Judged cannot_tell more than once; reword or make mechanical: ${h.reword.join(', ')}`);
  }
  return parts.join('\n');
}
