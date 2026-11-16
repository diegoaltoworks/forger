/**
 * Handing a ticket back when its probe fails: label the issue `needs-human`,
 * comment the command with the expected and the actual result, and take it
 * out of the queue so the next pick is another ticket. Every tracker call goes
 * through the injected tracker.
 */

import type {Tracker} from '../ports';
import {handoverCommands, NEEDS_HUMAN_LABEL} from './handover-io';
import {listIssueLabels} from './labels';

/** Throws when the label did not land, since the ticket would be picked again. */
export function probeHandBack(tracker: Tracker, issue: number, comment: string, intakeLabel: string): void {
  for (const write of handoverCommands(issue, comment)) tracker.apply(write);
  if (!listIssueLabels(tracker, issue).some(l => l.toLowerCase() === NEEDS_HUMAN_LABEL)) {
    throw new Error(`issue #${issue} was not labelled ${NEEDS_HUMAN_LABEL} (does the label exist? run setup)`);
  }
  tracker.apply({kind: 'labels', ticket: issue, add: [], remove: [intakeLabel]});
}
