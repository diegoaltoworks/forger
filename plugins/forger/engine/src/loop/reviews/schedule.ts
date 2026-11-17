/**
 * What every periodic review shares: a kind names its label, issue title,
 * template and the event that records it was filed. The schedule counts merges
 * since the kind's last filing and files one issue unless one is already open.
 */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import type {Tracker} from '../../ports';
import {filedLabels} from '../../tracker';
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

export function reviewIsOpen(tracker: Tracker, kind: ReviewKind): boolean {
  return tracker.list({state: 'open', label: kind.label}).length > 0;
}

export function createReviewIssue(tracker: Tracker, kind: ReviewKind, intakeLabel: string, body: string): void {
  tracker.apply({kind: 'file', title: kind.title, body, labels: filedLabels(tracker.queue, intakeLabel, [kind.label])});
}

/** The kind's template as installed, or null when the pack is not. */
export function readReviewTemplate(projectRoot: string, kind: ReviewKind): string | null {
  const file = join(projectRoot, kind.template);
  return existsSync(file) ? readFileSync(file, 'utf-8') : null;
}
