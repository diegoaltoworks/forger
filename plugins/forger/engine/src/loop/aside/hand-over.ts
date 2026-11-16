/**
 * Setting a ticket aside on the tracker: the `needs-human` label and the
 * reason as a comment. A ticket `handover` already labelled and commented is
 * not commented again. Every tracker call goes through the injected tracker;
 * a failure is returned, not thrown, since the ticket is set aside either way.
 */

import type {Tracker, TrackerWrite} from '../../ports';
import {listIssueLabels} from '../labels';
import {NEEDS_HUMAN_LABEL} from '../handover-io';

/** Labels the issue and posts `comment` unless it was labelled before (`always` posts regardless); the problems met. */
export function setAsideOnTracker(tracker: Tracker, issue: number, comment: string, always: boolean): string[] {
  const problems: string[] = [];
  let labelled = false;
  try {
    labelled = listIssueLabels(tracker, issue).some(l => l.toLowerCase() === NEEDS_HUMAN_LABEL);
  } catch (e) {
    problems.push(`could not read the labels of #${issue}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const writes: TrackerWrite[] = [{kind: 'labels', ticket: issue, add: [NEEDS_HUMAN_LABEL], remove: []}];
  if (always || !labelled) writes.push({kind: 'comment', ticket: issue, body: comment});
  for (const w of writes) {
    try {
      tracker.apply(w);
    } catch (e) {
      problems.push(`could not write the ${w.kind} of #${issue}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return problems;
}
