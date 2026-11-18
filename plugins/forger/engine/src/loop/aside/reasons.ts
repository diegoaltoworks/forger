/**
 * What the owner sees of a ticket set aside, and what answering it undoes.
 * Pure over the recorded events.
 */

import type {TrackerWrite} from '../../ports';
import type {TerminalEvent} from '../events';
import {issueNumber} from '../decline';
import {NEEDS_HUMAN_LABEL} from '../handover-io';

/** The latest reason for each issue the loop set aside, by issue number. */
export function setAsideReasons(events: TerminalEvent[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const e of events) {
    if (e.event !== 'set_aside' || e.ticket === null) continue;
    const issue = issueNumber(e.ticket);
    if (issue !== null) out.set(issue, e.reason ?? 'no reason recorded');
  }
  return out;
}

/** The first line of a reason, for a report line; the full text stays in the event and on the issue. */
export function reasonSummary(reason: string): string {
  return reason.split('\n').find(l => l.trim() !== '')?.trim() ?? reason;
}

/** The writes that return an answered ticket to the queue: one removes needs-human, the next adds the intake label. */
export function answerCommands(issue: number, intakeLabel: string): TrackerWrite[] {
  return [
    {kind: 'labels', ticket: issue, add: [], remove: [NEEDS_HUMAN_LABEL]},
    {kind: 'labels', ticket: issue, add: [intakeLabel], remove: []},
  ];
}

/** The comment that tells the owner why a plain stop set the ticket aside. */
export function setAsideComment(issue: number, reason: string, keptWork = false): string {
  const kept = keptWork ? ['', 'The uncommitted work was kept as a commit on the ticket\'s branch, which is on the machine that ran the loop and not on the remote.'] : [];
  return [`The worker stopped, so the loop set this ticket aside and went on to others.`, '', `Reason: ${reason}`, ...kept, '', `Answer with: decide ${issue} "<choice>"`].join('\n');
}
