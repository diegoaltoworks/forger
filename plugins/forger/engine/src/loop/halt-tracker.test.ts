import {mkdtempSync, readFileSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {describe, expect, test} from 'bun:test';

import {postable} from './halt-label';
import {defaultState, LoopStore} from './state';
import {githubTracker} from '../tracker';
import {StatusIssueHalt, HALT_READ_TTL_MS} from './halt-tracker';
import {LOOP_ISSUE_TITLE} from './halt-label';

const LISTED = JSON.stringify([{number: 7, title: LOOP_ISSUE_TITLE}]);

function fake(handler: (cmd: string) => string) {
  const calls: string[] = [];
  const run = (cmd: string): string => {
    calls.push(cmd);
    return handler(cmd);
  };
  return {run, calls};
}

describe('StatusIssueHalt', () => {
  test('set comments the reason, then adds the label, creating the issue when absent', () => {
    const f = fake(cmd => (cmd.startsWith('gh issue create') ? 'https://github.com/o/r/issues/7\n' : cmd.startsWith('gh issue list') ? '[]' : ''));
    new StatusIssueHalt(githubTracker(f.run)).set('too many failures');
    expect(f.calls.some(c => c.startsWith('gh issue create'))).toBe(true);
    const comment = f.calls.findIndex(c => c.startsWith('gh issue comment 7') && c.includes('too many failures'));
    const label = f.calls.findIndex(c => c === "gh issue edit 7 --add-label 'halted'");
    expect(comment).toBeGreaterThan(-1);
    expect(label).toBeGreaterThan(comment);
  });

  test('clear removes the label; with no issue it does nothing', () => {
    const f = fake(cmd => (cmd.startsWith('gh issue list') ? LISTED : ''));
    new StatusIssueHalt(githubTracker(f.run)).clear();
    expect(f.calls).toContain("gh issue edit 7 --remove-label 'halted'");
    const none = fake(cmd => (cmd.startsWith('gh issue list') ? '[]' : ''));
    new StatusIssueHalt(githubTracker(none.run)).clear();
    expect(none.calls.some(c => c.includes('--remove-label'))).toBe(false);
  });

  test('read reports the label and the last comment as the reason', () => {
    const f = fake(cmd => {
      if (cmd.startsWith('gh issue list')) return LISTED;
      if (cmd.includes('--json labels')) return 'P3\nhalted\n';
      return 'owner stop\n';
    });
    expect(new StatusIssueHalt(githubTracker(f.run)).read()).toEqual({label: true, reason: 'owner stop'});
  });

  test('read without the label is not halted', () => {
    const f = fake(cmd => (cmd.startsWith('gh issue list') ? LISTED : cmd.includes('--json labels') ? 'P3' : ''));
    expect(new StatusIssueHalt(githubTracker(f.run)).read()).toEqual({label: false, reason: null});
  });

  test('a failing gh reads as not halted', () => {
    const f = fake(() => {
      throw new Error('network');
    });
    expect(new StatusIssueHalt(githubTracker(f.run)).read()).toEqual({label: false, reason: null});
  });

  test('reads are cached until the TTL, and a removed label is seen after it', () => {
    let t = 0;
    let labels = 'halted';
    const f = fake(cmd => (cmd.startsWith('gh issue list') ? LISTED : cmd.includes('--json labels') ? labels : ''));
    const h = new StatusIssueHalt(githubTracker(f.run), () => t);
    expect(h.read().label).toBe(true);
    const n = f.calls.length;
    labels = '';
    expect(h.read().label).toBe(true);
    expect(f.calls.length).toBe(n);
    t = HALT_READ_TTL_MS + 1;
    expect(h.read().label).toBe(false);
  });

  test('writeStatus edits the body', () => {
    const f = fake(cmd => (cmd.startsWith('gh issue list') ? LISTED : ''));
    new StatusIssueHalt(githubTracker(f.run)).writeStatus('hello');
    expect(f.calls).toContain("gh issue edit 7 --body 'hello'");
  });

  const scrub = (t: string): string => postable(t, '/srv/me/work/repo', '/srv/me');
  const leak = "fatal: '/srv/me/work/repo/.forger/worktrees/a' failed";

  test('the status body shows the last error with no absolute path', () => {
    const f = fake(cmd => (cmd.startsWith('gh issue list') ? LISTED : ''));
    const t = new StatusIssueHalt(githubTracker(f.run), Date.now, undefined, scrub);
    const store = new LoopStore({readState: () => null, writeState: () => {}} as never, '/nonexistent/HALT', t);
    store.publishStatus({...defaultState(), last_error: leak});
    const edit = f.calls.find(c => c.startsWith('gh issue edit 7 --body')) ?? '';
    expect(edit).toContain(".forger/worktrees/a");
    expect(edit).not.toContain('/srv/me');
  });

  test('the comment that carries a halt reason has no absolute path', () => {
    const f = fake(cmd => (cmd.startsWith('gh issue list') ? LISTED : ''));
    new StatusIssueHalt(githubTracker(f.run), Date.now, undefined, scrub).set(leak);
    const comment = f.calls.find(c => c.startsWith('gh issue comment')) ?? '';
    expect(comment).toContain(".forger/worktrees/a");
    expect(comment).not.toContain('/srv/me');
  });

  test('the HALT file and the log keep the full path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'halt-'));
    const file = join(dir, 'HALT');
    const down = {read: () => ({label: false, reason: null}), set: () => { throw new Error('down'); }, clear: () => {}, writeStatus: () => {}};
    new LoopStore({readState: () => null, writeState: () => {}} as never, file, down).writeHalt(leak);
    expect(readFileSync(file, 'utf-8')).toContain('/srv/me/work/repo/.forger');
    rmSync(dir, {recursive: true});
  });
});

describe('the status issue through the tracker', () => {
  test('the halt signal takes the lowest-numbered ticket with its title', () => {
    const f = fake(cmd => (cmd.startsWith('gh issue list') ? JSON.stringify([{number: 9, title: LOOP_ISSUE_TITLE}, {number: 4, title: LOOP_ISSUE_TITLE}, {number: 2, title: 'Forger loop notes'}]) : ''));
    new StatusIssueHalt(githubTracker(f.run)).writeStatus('x');
    expect(f.calls).toContain("gh issue edit 4 --body 'x'");
  });

  test('the halt signal sets, clears and reads through the tracker', () => {
    let labels = '';
    const f = fake(cmd => {
      if (cmd.startsWith('gh issue list')) return LISTED;
      if (cmd.includes('--json labels')) return labels;
      if (cmd.includes('--add-label')) labels = 'halted';
      if (cmd.includes('--remove-label')) labels = '';
      return 'why';
    });
    const h = new StatusIssueHalt(githubTracker(f.run), () => 0);
    h.set('why');
    expect(h.read()).toEqual({label: true, reason: 'why'});
    h.clear();
    expect(new StatusIssueHalt(githubTracker(f.run)).read().label).toBe(false);
  });
});
