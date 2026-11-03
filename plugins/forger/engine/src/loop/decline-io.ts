/**
 * Declining as a side effect: write the record the engine reads, and take the
 * ticket out of the queue. On GitHub the issue swaps the intake label for
 * `needs-info` and gets the detail as a comment; a file backlog marks the
 * ticket `needs_info`. Every tracker call goes through the injected runner.
 */

import {existsSync, readFileSync, unlinkSync, writeFileSync} from 'fs';

import type {CommandRunner} from '../ports';
import {issueNumber, parseDeclineRecord, type DeclineRecord} from './decline';

export const NEEDS_INFO_LABEL = 'needs-info';

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function writeDeclineRecord(file: string, record: DeclineRecord): void {
  writeFileSync(file, JSON.stringify(record, null, 2));
}

export function readDeclineRecord(file: string): DeclineRecord | null {
  return existsSync(file) ? parseDeclineRecord(readFileSync(file, 'utf-8')) : null;
}

export function clearDeclineRecord(file: string): void {
  if (existsSync(file)) unlinkSync(file);
}

/** The commands that relabel a declined issue and say why; pure. */
export function githubDeclineCommands(issue: number, intakeLabel: string, record: DeclineRecord): string[] {
  const comment = `The loop declined this ticket (${record.reason}).\n\n${record.detail}\n\nEdit the issue to answer this, then relabel it ${intakeLabel}.`;
  return [
    `gh issue edit ${issue} --remove-label ${shellQuote(intakeLabel)} --add-label ${NEEDS_INFO_LABEL}`,
    `gh issue comment ${issue} --body ${shellQuote(comment)}`,
  ];
}

export interface DeclineTarget {
  trackerKind: 'github' | 'local' | 'none';
  intakeLabel: string;
  backlogFile: string;
}

/** Takes the ticket out of the queue. Returns what it did, for the command's output. */
export function leaveQueue(run: CommandRunner, target: DeclineTarget, record: DeclineRecord): string {
  if (target.trackerKind === 'github') {
    const issue = issueNumber(record.ticket);
    if (issue === null) throw new Error(`"${record.ticket}" is not an issue-<n> ticket, so there is no issue to relabel`);
    for (const cmd of githubDeclineCommands(issue, target.intakeLabel, record)) run(cmd);
    return `issue #${issue} relabelled ${NEEDS_INFO_LABEL}`;
  }
  const data = JSON.parse(readFileSync(target.backlogFile, 'utf-8')) as {features?: Record<string, {status?: string}>};
  const ticket = data.features?.[record.ticket];
  if (!ticket) throw new Error(`"${record.ticket}" is not in the backlog`);
  ticket.status = 'needs_info';
  writeFileSync(target.backlogFile, JSON.stringify(data, null, 2) + '\n');
  return `${record.ticket} marked needs_info`;
}
