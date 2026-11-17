import {linkBlockers} from '../backlog';
import type {CommandRunner, Tracker} from '../ports';
import {filedLabels} from '../tracker';
import {issueBody, type IssuePlan} from './replay';

export interface Filed {
  id: string;
  number: number;
  title: string;
  blockedBy: number[];
}

/** Files the plan in order with the intake label, then links each issue's blockers natively. */
export function fileReplay(tracker: Tracker, run: CommandRunner, plan: IssuePlan[], intakeLabel: string): Filed[] {
  const numbers: Record<string, number> = {};
  const filed: Filed[] = [];
  for (const p of plan) {
    const url = tracker.apply({kind: 'file', title: p.title, body: issueBody(p, numbers), labels: filedLabels(tracker.queue, intakeLabel)}).trim();
    const number = Number(url.match(/(\d+)\s*$/)?.[1]);
    if (!Number.isInteger(number)) throw new Error(`could not read the issue number for "${p.id}" from: ${url}`);
    numbers[p.id] = number;
    if (p.blockedBy.length) linkBlockers(run, number);
    filed.push({id: p.id, number, title: p.title, blockedBy: p.blockedBy.map(b => numbers[b])});
  }
  return filed;
}
