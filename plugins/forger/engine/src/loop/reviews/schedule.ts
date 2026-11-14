/**
 * What every periodic review shares: a kind names its label, issue title,
 * template and the event that records it was filed. The schedule counts merges
 * since the kind's last filing and files one issue unless one is already open.
 */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import type {CommandRunner} from '../../ports';
import type {EventKind, TerminalEvent} from '../events';

export interface ReviewKind {
  label: string;
  title: string;
  /** Project-relative path of the issue body the pack installs. */
  template: string;
  filedEvent: EventKind;
}

/** Merges recorded since the kind was last filed, or since the first event when it never was. */
export function mergesSinceFiled(events: TerminalEvent[], filedEvent: EventKind): number {
  let n = 0;
  for (const e of events) {
    if (e.event === filedEvent) n = 0;
    else if (e.event === 'merged') n++;
  }
  return n;
}

function quote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function reviewIsOpen(run: CommandRunner, kind: ReviewKind): boolean {
  return run(`gh issue list --label ${kind.label} --state open --json number --jq ".[].number"`).trim() !== '';
}

export function createReviewIssue(run: CommandRunner, kind: ReviewKind, intakeLabel: string, body: string): void {
  run(`gh issue create --title ${quote(kind.title)} --body ${quote(body)} --label ${quote(kind.label)} --label ${quote(intakeLabel)}`);
}

/** The kind's template as installed, or null when the pack is not. */
export function readReviewTemplate(projectRoot: string, kind: ReviewKind): string | null {
  const file = join(projectRoot, kind.template);
  return existsSync(file) ? readFileSync(file, 'utf-8') : null;
}
