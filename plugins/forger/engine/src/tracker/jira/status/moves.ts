/**
 * The three status moves of an issue and what a merge writes when no done
 * status is configured. Each is a decision over facts: what to do, never the
 * doing. For a tracker with no Jira settings every answer is nothing to do.
 */

import type {JiraSettings} from '../../../config';
import type {StatusEvent, TrackerWrite} from '../../../ports';

export interface Transition {
  id: string;
  name?: string;
  to?: {name?: string};
}

export type Move = {do: 'none'} | {do: 'transition'; id: string} | {do: 'log'; line: string};

/** The status the event moves an issue to; null when none is configured, and no transition is read then. */
export function wantedStatus(settings: Pick<JiraSettings, 'statuses'> | null, event: StatusEvent): string | null {
  const name = settings?.statuses?.[event];
  return name && name.trim() !== '' ? name : null;
}

/** The transition that leads to the status, among those the issue offers; its target is matched before its own name. */
export function moveTo(status: string | null, key: string, transitions: Transition[]): Move {
  if (status === null) return {do: 'none'};
  const same = (a: string | undefined) => a !== undefined && a.toLowerCase() === status.toLowerCase();
  const found = transitions.find(t => same(t.to?.name)) ?? transitions.find(t => same(t.name));
  if (found) return {do: 'transition', id: found.id};
  return {do: 'log', line: `${key} has no transition to "${status}"; the status stays and the run goes on`};
}

/** After a merge with no done status: the pull request's address and the label that replaces the intake label. */
export function mergedWrites(settings: Pick<JiraSettings, 'statuses'> | null, ticket: number, prUrl: string, intakeLabel: string): TrackerWrite[] {
  if (settings === null || wantedStatus(settings, 'done') !== null) return [];
  return [
    {kind: 'comment', ticket, body: `Merged: ${prUrl}`},
    {kind: 'labels', ticket, add: ['merged'], remove: [intakeLabel]},
  ];
}
