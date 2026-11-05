import {linkBlockers} from '../backlog';
import type {CommandRunner} from '../ports';
import {issueBody, type IssuePlan} from './replay';

export interface Filed {
  id: string;
  number: number;
  title: string;
  blockedBy: number[];
}

function quote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Files the plan in order with the intake label, then links each issue's blockers natively. */
export function fileReplay(run: CommandRunner, plan: IssuePlan[], label: string | null): Filed[] {
  const numbers: Record<string, number> = {};
  const filed: Filed[] = [];
  for (const p of plan) {
    const flag = label ? ` --label ${quote(label)}` : '';
    const url = run(`gh issue create --title ${quote(p.title)} --body ${quote(issueBody(p, numbers))}${flag}`).trim();
    const number = Number(url.match(/(\d+)\s*$/)?.[1]);
    if (!Number.isInteger(number)) throw new Error(`could not read the issue number for "${p.id}" from: ${url}`);
    numbers[p.id] = number;
    if (p.blockedBy.length) linkBlockers(run, number);
    filed.push({id: p.id, number, title: p.title, blockedBy: p.blockedBy.map(b => numbers[b])});
  }
  return filed;
}
