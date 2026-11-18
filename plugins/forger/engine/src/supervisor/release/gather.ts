/** The tickets merged since a version, read through the command runner and the tracker port. */

import type {CommandRunner, Tracker} from '../../ports';
import type {Change} from './plan';

const PR_AT_END = /^(.*) \(#(\d+)\)$/;

/** The merges a first-parent log of tab-separated hash and subject names, oldest first; a subject without a trailing PR number is not a merged ticket. */
export function mergesFromLog(log: string): {pr: number; title: string}[] {
  return log
    .split('\n')
    .map(line => PR_AT_END.exec(line.split('\t')[1] ?? ''))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => ({pr: Number(m[2]), title: m[1].replace(/(\s*\(#\d+\))+$/, '')}));
}

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The commit the range starts from: the tag of the current version, else the commit that last changed the version in the first file. */
export function sinceRef(run: CommandRunner, current: string, firstFile: string): string | null {
  const tag = `v${current}`;
  if (run(`git tag -l ${quote(tag)}`).trim() !== '') return tag;
  const sha = run(`git log -1 --format=%H -S${quote(`"${current}"`)} -- ${quote(firstFile)}`).trim();
  return sha === '' ? null : sha;
}

export function gatherChanges(run: CommandRunner, tracker: Tracker, opts: {baseBranch: string; current: string; firstFile: string}): Change[] {
  const since = sinceRef(run, opts.current, opts.firstFile);
  const range = since === null ? `origin/${opts.baseBranch}` : `${since}..origin/${opts.baseBranch}`;
  const merges = mergesFromLog(run(`git log --first-parent --reverse --format=%H%x09%s ${range}`));
  if (merges.length === 0) return [];
  const prs = JSON.parse(run(`gh pr list --state merged --base ${quote(opts.baseBranch)} --limit 1000 --json number,closingIssuesReferences`)) as {number: number; closingIssuesReferences?: {number: number}[]}[];
  const closing = new Map(prs.map(p => [p.number, p.closingIssuesReferences?.[0]?.number ?? null]));
  const labels = new Map(tracker.tickets({state: 'closed', limit: 1000}).map(t => [t.number, t.labels]));
  return merges.map(m => {
    const ticket = closing.get(m.pr) ?? null;
    return {pr: m.pr, ticket, title: m.title, labels: ticket === null ? [] : (labels.get(ticket) ?? [])};
  });
}
