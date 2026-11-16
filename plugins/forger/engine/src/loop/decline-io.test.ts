import {afterEach, describe, expect, test} from 'bun:test';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {clearDeclineRecord, githubDeclineCommands, leaveQueue, readDeclineRecord, writeDeclineRecord} from './decline-io';
import type {DeclineRecord} from './decline';
import {githubCommand, githubTracker, openTracker} from '../tracker';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'forger-decline-'));
  dirs.push(d);
  return d;
};

const fileTracker = (run: (cmd: string) => string) => openTracker({tracker: {kind: 'local', label: 'x'}} as never, run);

const record: DeclineRecord = {ticket: 'issue-7', reason: 'blocked', detail: "needs the owner's key", at: 't'};

describe('leaveQueue on GitHub', () => {
  test('swaps the intake label for needs-info and comments the detail', () => {
    const calls: string[] = [];
    const msg = leaveQueue(githubTracker(cmd => (calls.push(cmd), cmd.startsWith('gh issue view') ? 'needs-info' : '')), {intakeLabel: 'ready-for-agent', backlogFile: ''}, record);
    expect(msg).toBe('issue #7 relabelled needs-info');
    expect(calls).toHaveLength(3);
    expect(calls[0]).toBe("gh issue edit 7 --add-label 'needs-info' --remove-label 'ready-for-agent'");
    expect(calls[1]).toStartWith('gh issue comment 7 --body ');
    expect(calls[1]).toContain("needs the owner'\\''s key");
    expect(calls[1]).toContain('(blocked)');
  });

  test('refuses a ticket that is not an issue', () => {
    expect(() =>
      leaveQueue(githubTracker(() => ''), {intakeLabel: 'x', backlogFile: ''}, {...record, ticket: 'local_one'})
    ).toThrow('not an issue-<n> ticket');
  });

  test('builds the same commands without running them', () => {
    expect(githubDeclineCommands(7, 'ready', record).map(githubCommand)[0]).toContain('--remove-label');
  });
});

describe('a decline in writes', () => {
  test('a decline is two writes: the label change and the comment', () => {
    const [labels, comment] = githubDeclineCommands(7, 'ready-for-agent', record);
    expect(labels).toEqual({kind: 'labels', ticket: 7, add: ['needs-info'], remove: ['ready-for-agent']});
    expect(comment).toMatchObject({kind: 'comment', ticket: 7});
    expect(githubDeclineCommands(7, 'ready-for-agent', record)).toHaveLength(2);
  });

  test('leaveQueue relabels through the tracker when the queue is there and marks the backlog file when it is not', () => {
    const calls: string[] = [];
    const run = (cmd: string): string => (calls.push(cmd), cmd.startsWith('gh issue view') ? 'needs-info' : '');
    leaveQueue(githubTracker(run), {intakeLabel: 'ready-for-agent', backlogFile: ''}, record);
    expect(calls.some(c => c.startsWith('gh issue edit 7'))).toBe(true);

    const file = join(tmp(), 'backlog.json');
    writeFileSync(file, JSON.stringify({features: {issue_x: {status: 'not_started'}}}));
    const none: string[] = [];
    leaveQueue(fileTracker(cmd => (none.push(cmd), '')), {intakeLabel: 'x', backlogFile: file}, {...record, ticket: 'issue_x'});
    expect(none).toEqual([]);
    expect(JSON.parse(readFileSync(file, 'utf-8')).features.issue_x.status).toBe('needs_info');
  });
});

describe('leaveQueue on a file backlog', () => {
  test('marks the ticket needs_info and calls no tracker', () => {
    const file = join(tmp(), 'backlog.json');
    writeFileSync(file, JSON.stringify({features: {issue_x: {status: 'not_started'}}}));
    const calls: string[] = [];
    leaveQueue(fileTracker(cmd => (calls.push(cmd), '')), {intakeLabel: 'x', backlogFile: file}, {...record, ticket: 'issue_x'});
    expect(JSON.parse(readFileSync(file, 'utf-8')).features.issue_x.status).toBe('needs_info');
    expect(calls).toEqual([]);
  });

  test('refuses a ticket the backlog does not hold', () => {
    const file = join(tmp(), 'backlog.json');
    writeFileSync(file, JSON.stringify({features: {}}));
    expect(() => leaveQueue(fileTracker(() => ''), {intakeLabel: 'x', backlogFile: file}, record)).toThrow('not in the backlog');
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
