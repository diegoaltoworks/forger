/**
 * The way down the ladder: which installed opinions do not earn their place,
 * and the issue draft that proposes a lower rung or removal. Pure; the owner
 * decides each one.
 */
import {RUNGS, type Rung} from '../../packs';
import type {OpinionFailures} from './failures';

export const DEFAULT_MIN_MERGED = 20;

export interface DemotionAssessment {
  opinion: string;
  rung: Rung;
  merged: number;
  min_merged: number;
  tickets_failed: number;
  ended_fixed: number;
  ended_waived: number;
  candidate: boolean;
  reason: 'never-failed' | 'waived-more-than-fixed' | null;
  /** The rung one step down, or 'removal' when the opinion is already on the lowest. */
  proposal: Rung | 'removal';
}

export function assessDemotion(row: OpinionFailures, rung: Rung, merged: number, minMerged: number): DemotionAssessment {
  const reason = row.never_failed && merged >= minMerged ? 'never-failed' : row.ended_waived > row.ended_fixed ? 'waived-more-than-fixed' : null;
  const below = RUNGS.indexOf(rung) - 1;
  return {opinion: row.opinion, rung, merged, min_merged: minMerged, tickets_failed: row.tickets_failed, ended_fixed: row.ended_fixed, ended_waived: row.ended_waived, candidate: reason !== null, reason, proposal: below < 0 ? 'removal' : RUNGS[below]};
}

export function demotionCandidates(rows: OpinionFailures[], rungs: ReadonlyMap<string, Rung>, merged: number, minMerged: number): DemotionAssessment[] {
  return rows
    .flatMap(r => (rungs.has(r.opinion) ? [assessDemotion(r, rungs.get(r.opinion) as Rung, merged, minMerged)] : []))
    .filter(a => a.candidate);
}

export function formatNumbers(a: DemotionAssessment): string {
  return `${a.opinion} (rung ${a.rung}): failed on ${a.tickets_failed} ticket(s), ${a.ended_fixed} fixed, ${a.ended_waived} waived, over ${a.merged} merged ticket(s) (${a.min_merged} needed to count a clean record)`;
}

export function formatCandidates(list: DemotionAssessment[]): string {
  return list.length === 0 ? 'no opinion is a candidate for demotion' : list.map(a => `${formatNumbers(a)}; ${a.reason}; propose ${a.proposal}`).join('\n');
}

export function draftDemotion(a: DemotionAssessment): {title: string; body: string} {
  const why = a.reason === 'never-failed' ? `its check never failed over ${a.merged} merged tickets` : `its failures ended waived (${a.ended_waived}) more often than fixed (${a.ended_fixed})`;
  const move = a.proposal === 'removal' ? 'remove it' : `move it down one rung, to ${a.proposal}`;
  return {
    title: `demote ${a.opinion}: ${a.proposal === 'removal' ? 'remove' : a.proposal}`,
    body: `## Proposal\n\nThe opinion ${a.opinion} sits on the ${a.rung} rung and ${why}. Proposal: ${move}.\n\n## Evidence\n\n- ${formatNumbers(a)}\n- from \`measure --opinions\`\n\n## Decision\n\nThe owner decides. Nothing changes until this issue is answered.`,
  };
}
