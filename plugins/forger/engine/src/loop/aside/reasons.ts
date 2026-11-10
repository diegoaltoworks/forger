/**
 * What the owner sees of a ticket set aside, and what answering it undoes.
 * Pure over the recorded events.
 */

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

/** The commands that return an answered ticket to the queue. */
export function answerCommands(issue: number, intakeLabel: string): string[] {
  return [`gh issue edit ${issue} --remove-label ${NEEDS_HUMAN_LABEL}`, `gh issue edit ${issue} --add-label '${intakeLabel.replace(/'/g, `'\\''`)}'`];
}

/** The comment that tells the owner why a plain stop set the ticket aside. */
export function setAsideComment(issue: number, reason: string): string {
  return [`The worker stopped, so the loop set this ticket aside and went on to others.`, '', `Reason: ${reason}`, '', `Answer with: decide ${issue} "<choice>"`].join('\n');
}
