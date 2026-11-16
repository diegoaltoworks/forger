/**
 * Handing a ticket to the owner when verification runs out of rounds: label the
 * issue `needs-human`, comment the criteria at fault, and confirm the label held.
 * Every tracker call goes through the injected tracker.
 */

import type {Tracker, TrackerWrite} from '../ports';
import {issueNumber} from './decline';
import {handoverComment, type HandedOver} from './handover';
import {listIssueLabels} from './labels';

export const NEEDS_HUMAN_LABEL = 'needs-human';

/** The writes that hand an issue over; pure. */
export function handoverCommands(issue: number, comment: string): TrackerWrite[] {
  return [
    {kind: 'labels', ticket: issue, add: [NEEDS_HUMAN_LABEL], remove: []},
    {kind: 'comment', ticket: issue, body: comment},
  ];
}

/** Hands the ticket's issue over; throws when the label did not land. */
export function handOver(tracker: Tracker, h: HandedOver, texts: Record<string, string>, intakeLabel: string): string {
  const issue = issueNumber(h.ticket);
  if (issue === null) throw new Error(`"${h.ticket}" is not an issue-<n> ticket, so there is no issue to hand over`);
  for (const write of handoverCommands(issue, handoverComment(h, texts))) tracker.apply(write);
  if (!listIssueLabels(tracker, issue).some(l => l.toLowerCase() === NEEDS_HUMAN_LABEL)) {
    throw new Error(`issue #${issue} was not labelled ${NEEDS_HUMAN_LABEL} (does the label exist? run setup)`);
  }
  // Out of the queue, so the next pick is another ticket.
  tracker.apply({kind: 'labels', ticket: issue, add: [], remove: [intakeLabel]});
  return `issue #${issue} labelled ${NEEDS_HUMAN_LABEL}`;
}
