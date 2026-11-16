/**
 * Declining as a side effect: write the record the engine reads, and take the
 * ticket out of the queue. In a tracker the issue swaps the intake label for
 * `needs-info` and gets the detail as a comment; a file backlog marks the
 * ticket `needs_info`. Every tracker call goes through the injected tracker.
 */

import {existsSync, readFileSync, unlinkSync, writeFileSync} from 'fs';

import type {Tracker, TrackerWrite} from '../ports';
import {declineRelabelProblems, listIssueLabels, NEEDS_INFO_LABEL} from './labels';
import {issueNumber, parseDeclineRecord, type DeclineRecord} from './decline';

export function writeDeclineRecord(file: string, record: DeclineRecord): void {
  writeFileSync(file, JSON.stringify(record, null, 2));
}

export function readDeclineRecord(file: string): DeclineRecord | null {
  return existsSync(file) ? parseDeclineRecord(readFileSync(file, 'utf-8')) : null;
}

export function clearDeclineRecord(file: string): void {
  if (existsSync(file)) unlinkSync(file);
}

/** The writes that relabel a declined issue and say why; pure. */
export function githubDeclineCommands(issue: number, intakeLabel: string, record: DeclineRecord): TrackerWrite[] {
  const comment = `The loop declined this ticket (${record.reason}).\n\n${record.detail}\n\nEdit the issue to answer this, then relabel it ${intakeLabel}.`;
  return [
    {kind: 'labels', ticket: issue, add: [NEEDS_INFO_LABEL], remove: [intakeLabel]},
    {kind: 'comment', ticket: issue, body: comment},
  ];
}

export interface DeclineTarget {
  intakeLabel: string;
  backlogFile: string;
}

/** Takes the ticket out of the queue. Returns what it did, for the command's output. */
export function leaveQueue(tracker: Tracker, target: DeclineTarget, record: DeclineRecord): string {
  if (tracker.queue === 'tracker') {
    const issue = issueNumber(record.ticket);
    if (issue === null) throw new Error(`"${record.ticket}" is not an issue-<n> ticket, so there is no issue to relabel`);
    for (const write of githubDeclineCommands(issue, target.intakeLabel, record)) tracker.apply(write);
    const problems = declineRelabelProblems(listIssueLabels(tracker, issue), target.intakeLabel);
    if (problems.length > 0) {
      throw new Error(`issue #${issue} was not relabelled: ${problems.join('; ')} (does the label exist? run setup)`);
    }
    return `issue #${issue} relabelled ${NEEDS_INFO_LABEL}`;
  }
  const data = JSON.parse(readFileSync(target.backlogFile, 'utf-8')) as {features?: Record<string, {status?: string}>};
  const ticket = data.features?.[record.ticket];
  if (!ticket) throw new Error(`"${record.ticket}" is not in the backlog`);
  ticket.status = 'needs_info';
  writeFileSync(target.backlogFile, JSON.stringify(data, null, 2) + '\n');
  return `${record.ticket} marked needs_info`;
}
