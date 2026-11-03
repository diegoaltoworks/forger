/**
 * Handing a ticket to the owner when verification runs out of rounds: label the
 * issue `needs-human`, comment the criteria at fault, and confirm the label held.
 * Every tracker call goes through the injected runner.
 */

import type {CommandRunner} from '../ports';
import {issueNumber} from './decline';
import {handoverComment, type HandedOver} from './handover';
import {listIssueLabels} from './labels';

export const NEEDS_HUMAN_LABEL = 'needs-human';

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** The commands that hand an issue over; pure. */
export function handoverCommands(issue: number, comment: string): string[] {
  return [
    `gh issue edit ${issue} --add-label ${NEEDS_HUMAN_LABEL}`,
    `gh issue comment ${issue} --body ${shellQuote(comment)}`,
  ];
}

/** Hands the ticket's issue over; throws when the label did not land. */
export function handOver(run: CommandRunner, h: HandedOver, texts: Record<string, string>, intakeLabel: string): string {
  const issue = issueNumber(h.ticket);
  if (issue === null) throw new Error(`"${h.ticket}" is not an issue-<n> ticket, so there is no issue to hand over`);
  for (const cmd of handoverCommands(issue, handoverComment(h, texts))) run(cmd);
  if (!listIssueLabels(run, issue).some(l => l.toLowerCase() === NEEDS_HUMAN_LABEL)) {
    throw new Error(`issue #${issue} was not labelled ${NEEDS_HUMAN_LABEL} (does the label exist? run setup)`);
  }
  // Out of the queue, so the next pick is another ticket.
  run(`gh issue edit ${issue} --remove-label ${shellQuote(intakeLabel)}`);
  return `issue #${issue} labelled ${NEEDS_HUMAN_LABEL}`;
}
