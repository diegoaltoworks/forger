import {afterEach, describe, expect, test} from 'bun:test';
import {appendFileSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {eventLine, parseWatchedEvents, terminalEvent} from '../loop';
import {followEvents} from './follow';
import {formatMultiReport, mergeReports, repoNames, tagEvent} from './multi';
import type {Report} from './supervisor';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'forger-multi-'));
  dirs.push(d);
  return d;
};

const report = (over: Partial<Report>): Report => ({
  period: {since: null},
  merged: [],
  in_progress: [],
  declined: [],
  recovered: [],
  flaky_gates: [],
  handed_over: [],
  next: [],
  waiting_on_owner: [],
  measures: null,
  ...over,
} as Report);

describe('repoNames', () => {
  test('folder names, or the whole path when two share one', () => {
    expect(repoNames(['/a/one', '/b/two/'])).toEqual(['one', 'two']);
    expect(repoNames(['/a/x', '/b/x'])).toEqual(['/a/x', '/b/x']);
  });
});

describe('mergeReports', () => {
  test('tags every item with its repository and keeps the sections apart', () => {
    const m = mergeReports([
      {repo: 'a', report: report({merged: ['#1 one'], in_progress: [{ticket: 'issue-2', branch: 'feat/issue-2'}], next: ['issue-3']})},
      {repo: 'b', report: report({merged: ['#9 nine'], waiting_on_owner: [{question: 'q', recommendation: 'r', because: 'b'}]})},
      {repo: 'c', report: {error: 'not a forger repo'}},
    ]);
    expect(m.merged).toEqual([{repo: 'a', item: '#1 one'}, {repo: 'b', item: '#9 nine'}]);
    expect(m.in_progress).toEqual([{repo: 'a', ticket: 'issue-2', branch: 'feat/issue-2'}]);
    expect(m.waiting_on_owner[0]).toMatchObject({repo: 'b', question: 'q'});
    expect(m.unreadable).toEqual([{repo: 'c', error: 'not a forger repo'}]);
    const text = formatMultiReport(m);
    expect(text).toContain('- [a] #1 one');
    expect(text).toContain('- [b] q - I recommend r, because b.');
    expect(text).toContain('[c] not a forger repo');
  });

  test('a repository with an unreadable merge list contributes none', () => {
    expect(mergeReports([{repo: 'a', report: report({merged: null})}]).merged).toEqual([]);
  });
});

describe('followEvents', () => {
  test('emits each new event once, as one tagged JSON line, across repositories', async () => {
    const [a, b] = [join(tmp(), 'events.jsonl'), join(tmp(), 'events.jsonl')];
    writeFileSync(a, eventLine(terminalEvent('completed', 1, 'old', null)));
    const read = (f: string) => () => {
      try {
        return parseWatchedEvents(require('fs').readFileSync(f, 'utf-8'));
      } catch {
        return [];
      }
    };
    const lines: string[] = [];
    let ticks = 0;
    await followEvents({
      repos: [{name: 'a', read: read(a), pollMs: 1}, {name: 'b', read: read(b), pollMs: 1}],
      emit: l => lines.push(l),
      timeoutMs: 4,
      tickMs: 1,
      sleep: async () => {
        ticks++;
        if (ticks === 1) appendFileSync(a, eventLine(terminalEvent('worker_denied', 2, 'issue-5', 'rule x')));
        if (ticks === 2) appendFileSync(b, eventLine(terminalEvent('halted', 3, null, 'stop')));
        if (ticks === 3) appendFileSync(a, `${JSON.stringify({event: 'picked', at: 'x', iteration: 3, ticket: 't', reason: null})}\n`);
      },
    });
    const got = lines.map(l => JSON.parse(l));
    expect(got.map(e => [e.repo, e.event])).toEqual([['a', 'worker_denied'], ['b', 'halted']]);
    expect(got[0]).toEqual(tagEvent('a', terminalEvent('worker_denied', 2, 'issue-5', 'rule x', new Date(got[0].at))));
    for (const l of lines) expect(l).not.toContain('\n');
  });

  test('a repository that cannot be read is reported once, not skipped', async () => {
    const lines: string[] = [];
    await followEvents({
      repos: [{name: 'broken', read: () => { throw new Error('no token'); }, pollMs: 1}],
      emit: l => lines.push(l),
      timeoutMs: 3,
      tickMs: 1,
      sleep: async () => {},
    });
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({repo: 'broken', event: 'watch_error', reason: 'no token'});
  });

  test('a slow repository is read less often than the tick', async () => {
    let reads = 0;
    await followEvents({repos: [{name: 'r', read: () => { reads++; return []; }, pollMs: 5}], emit: () => {}, timeoutMs: 10, tickMs: 1, sleep: async () => {}});
    expect(reads).toBeLessThan(5);
  });
});
