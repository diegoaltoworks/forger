/**
 * One supervisor over several loops: events and reports from each repository,
 * every item tagged with the repository it came from. Pure.
 */

import {basename} from 'path';

import type {TerminalEvent} from '../loop';
import type {Report} from './supervisor';

export interface TaggedEvent extends TerminalEvent {
  repo: string;
}

/** A name per path: the folder name, or the whole path for a folder name two repositories share. */
export function repoNames(paths: string[]): string[] {
  const base = paths.map(p => basename(p.replace(/\/+$/, '')) || p);
  return base.map((b, i) => (base.filter(x => x === b).length > 1 ? paths[i] : b));
}

export function tagEvent(repo: string, e: TerminalEvent): TaggedEvent {
  return {repo, ...e};
}

export interface RepoReport {
  repo: string;
  /** The repository's report, or why it could not be produced. */
  report: Report | {error: string};
}

type Tagged<T> = T extends string ? {repo: string; item: string} : T & {repo: string};

export interface MultiReport {
  repos: string[];
  /** Repositories whose report could not be produced, with the reason. */
  unreadable: Array<{repo: string; error: string}>;
  merged: Array<{repo: string; item: string}>;
  in_progress: Array<Tagged<Report['in_progress'][number]>>;
  declined: Array<Tagged<Report['declined'][number]>>;
  recovered: Array<{repo: string; item: string}>;
  handed_over: Array<Tagged<Report['handed_over'][number]>>;
  next: Array<{repo: string; item: string}>;
  waiting_on_owner: Array<Tagged<Report['waiting_on_owner'][number]>>;
}

const tag = <T extends object>(repo: string, items: T[]): Array<T & {repo: string}> => items.map(i => ({repo, ...i}));
const tagText = (repo: string, items: string[]): Array<{repo: string; item: string}> => items.map(item => ({repo, item}));

export function mergeReports(reports: RepoReport[]): MultiReport {
  const out: MultiReport = {repos: reports.map(r => r.repo), unreadable: [], merged: [], in_progress: [], declined: [], recovered: [], handed_over: [], next: [], waiting_on_owner: []};
  for (const {repo, report: r} of reports) {
    if ('error' in r) {
      out.unreadable.push({repo, error: r.error});
      continue;
    }
    out.merged.push(...tagText(repo, r.merged ?? []));
    out.in_progress.push(...tag(repo, r.in_progress));
    out.declined.push(...tag(repo, r.declined));
    out.recovered.push(...tagText(repo, r.recovered));
    out.handed_over.push(...tag(repo, r.handed_over));
    out.next.push(...tagText(repo, r.next));
    out.waiting_on_owner.push(...tag(repo, r.waiting_on_owner));
  }
  return out;
}

export function formatMultiReport(m: MultiReport): string {
  const list = (items: string[]): string[] => (items.length ? items.map(t => `- ${t}`) : ['- none']);
  return [
    '**Merged**',
    ...list(m.merged.map(i => `[${i.repo}] ${i.item}`)),
    '',
    '**In progress**',
    ...list(m.in_progress.map(p => `[${p.repo}] ${p.ticket} on branch \`${p.branch || 'detached'}\``)),
    '',
    '**Declined**',
    ...list(m.declined.map(d => `[${d.repo}] ${d.ticket} (${d.reason})`)),
    '',
    '**Recovered by the engine**',
    ...list(m.recovered.map(i => `[${i.repo}] ${i.item}`)),
    '',
    '**Handed over**',
    ...list(m.handed_over.map(h => `[${h.repo}] ${h.ticket} (PR #${h.pr}): ${h.criteria.join(', ')}`)),
    '',
    '**Next**',
    ...list(m.next.map(i => `[${i.repo}] ${i.item}`)),
    '',
    '**Waiting on you**',
    ...list(m.waiting_on_owner.map(o => `[${o.repo}] ${o.question} - I recommend ${o.recommendation}, because ${o.because}.`)),
    ...(m.unreadable.length ? ['', '**Could not be read**', ...list(m.unreadable.map(u => `[${u.repo}] ${u.error}`))] : []),
  ].join('\n');
}
