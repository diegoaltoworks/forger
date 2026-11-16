/**
 * Who merges a ticket. A ticket says `when green` (the default) or `owner
 * reviews`; the latter is built, gated and verified like any other, but its PR
 * is left open for the owner, so a judgement a machine cannot make does not
 * halt the loop. Pure over ticket text and ticket ids.
 */

import type {TrackerWrite} from '../ports';

type LabelWrite = Extract<TrackerWrite, {kind: 'labels'}>;

export const OWNER_REVIEW_LABEL = 'owner-review';

export type MergeMode = 'when green' | 'owner reviews';

/** The first non-comment line under a `Merge` heading; anything but `owner reviews` merges when green. */
export function mergeMode(body: string | null | undefined): MergeMode {
  if (!body) return 'when green';
  let inSection = false;
  for (const line of body.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.*?)\s*$/.exec(line);
    if (heading) {
      if (inSection) return 'when green';
      inSection = /^merge\s*:?$/i.test(heading[1]);
      continue;
    }
    if (inSection && line.trim() !== '') {
      return /^[`*_\s-]*owner\s+reviews\b/i.test(line.trim()) ? 'owner reviews' : 'when green';
    }
  }
  return 'when green';
}

/** Why `merge` refuses a PR whose ticket the owner merges; null when it may go on. */
export function ownerReviewRefusal(mode: MergeMode, pr: number): string | null {
  return mode === 'owner reviews'
    ? `the ticket says "owner reviews": leave PR #${pr} open for the owner to merge; the engine labels it ${OWNER_REVIEW_LABEL}`
    : null;
}

/** The issue number of a ticket id such as `issue-7`; null for any other id. */
export function issueOfTicket(ticket: string | null): number | null {
  const m = /^issue-(\d+)$/.exec(ticket ?? '');
  return m ? Number(m[1]) : null;
}

/** What an owner review marks: the pull request on the code host, as a command, and the issue on the tracker, as a write. */
export function ownerReviewLabelCommands(pr: number, issue: number | null): {pullRequest: string; issue: LabelWrite | null} {
  return {
    pullRequest: `gh pr edit ${pr} --add-label ${OWNER_REVIEW_LABEL}`,
    issue: issue === null ? null : {kind: 'labels', ticket: issue, add: [OWNER_REVIEW_LABEL], remove: []},
  };
}

export interface OwnerMergeSettlement {
  pending: string[];
  completed_tasks: string[];
  /** Tickets whose PR the owner merged since the last look. */
  completed: string[];
}

/**
 * Tickets left for the owner that the tracker now reads completed (the owner's
 * merge closed the issue) move to the completed list; the rest keep waiting.
 */
export function settleOwnerMerges(pending: string[], completedTasks: string[], isCompleted: (ticket: string) => boolean): OwnerMergeSettlement {
  const done = pending.filter(isCompleted);
  return {
    pending: pending.filter(t => !done.includes(t)),
    completed_tasks: [...completedTasks, ...done.filter(t => !completedTasks.includes(t))],
    completed: done,
  };
}
