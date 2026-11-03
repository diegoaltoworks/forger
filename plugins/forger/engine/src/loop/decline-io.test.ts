import {afterEach, describe, expect, test} from 'bun:test';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {clearDeclineRecord, githubDeclineCommands, leaveQueue, readDeclineRecord, writeDeclineRecord} from './decline-io';
import type {DeclineRecord} from './decline';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'forger-decline-'));
  dirs.push(d);
  return d;
};

const record: DeclineRecord = {ticket: 'issue-7', reason: 'blocked', detail: "needs the owner's key", at: 't'};

describe('leaveQueue on GitHub', () => {
  test('swaps the intake label for needs-info and comments the detail', () => {
    const calls: string[] = [];
    const msg = leaveQueue(cmd => (calls.push(cmd), ''), {trackerKind: 'github', intakeLabel: 'ready-for-agent', backlogFile: ''}, record);
    expect(msg).toBe('issue #7 relabelled needs-info');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe("gh issue edit 7 --remove-label 'ready-for-agent' --add-label needs-info");
    expect(calls[1]).toStartWith('gh issue comment 7 --body ');
    expect(calls[1]).toContain("needs the owner'\\''s key");
    expect(calls[1]).toContain('(blocked)');
  });

  test('refuses a ticket that is not an issue', () => {
    expect(() =>
      leaveQueue(() => '', {trackerKind: 'github', intakeLabel: 'x', backlogFile: ''}, {...record, ticket: 'local_one'})
    ).toThrow('not an issue-<n> ticket');
  });

  test('builds the same commands without running them', () => {
    expect(githubDeclineCommands(7, 'ready', record)[0]).toContain('--remove-label');
  });
});

describe('leaveQueue on a file backlog', () => {
  test('marks the ticket needs_info and calls no tracker', () => {
    const file = join(tmp(), 'backlog.json');
    writeFileSync(file, JSON.stringify({features: {issue_x: {status: 'not_started'}}}));
    const calls: string[] = [];
    leaveQueue(cmd => (calls.push(cmd), ''), {trackerKind: 'local', intakeLabel: 'x', backlogFile: file}, {...record, ticket: 'issue_x'});
    expect(JSON.parse(readFileSync(file, 'utf-8')).features.issue_x.status).toBe('needs_info');
    expect(calls).toEqual([]);
  });

  test('refuses a ticket the backlog does not hold', () => {
    const file = join(tmp(), 'backlog.json');
    writeFileSync(file, JSON.stringify({features: {}}));
    expect(() => leaveQueue(() => '', {trackerKind: 'none', intakeLabel: 'x', backlogFile: file}, record)).toThrow('not in the backlog');
  });
});

test('the record round-trips through its file and clears', () => {
  const file = join(tmp(), 'declined.json');
  expect(readDeclineRecord(file)).toBeNull();
  writeDeclineRecord(file, record);
  expect(readDeclineRecord(file)).toEqual(record);
  clearDeclineRecord(file);
  expect(readDeclineRecord(file)).toBeNull();
});
