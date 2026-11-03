import {describe, expect, test} from 'bun:test';

import {GhTrackerHalt, HALT_READ_TTL_MS} from './halt-tracker';

function fake(handler: (cmd: string) => string) {
  const calls: string[] = [];
  const run = (cmd: string): string => {
    calls.push(cmd);
    return handler(cmd);
  };
  return {run, calls};
}

describe('GhTrackerHalt', () => {
  test('set comments the reason, then adds the label, creating the issue when absent', () => {
    const f = fake(cmd => (cmd.startsWith('gh issue create') ? 'https://github.com/o/r/issues/7\n' : ''));
    new GhTrackerHalt(f.run).set('too many failures');
    expect(f.calls.some(c => c.startsWith('gh issue create'))).toBe(true);
    const comment = f.calls.findIndex(c => c.startsWith('gh issue comment 7') && c.includes('too many failures'));
    const label = f.calls.findIndex(c => c === 'gh issue edit 7 --add-label halted');
    expect(comment).toBeGreaterThan(-1);
    expect(label).toBeGreaterThan(comment);
  });

  test('clear removes the label; with no issue it does nothing', () => {
    const f = fake(cmd => (cmd.startsWith('gh issue list') ? '7\n' : ''));
    new GhTrackerHalt(f.run).clear();
    expect(f.calls).toContain('gh issue edit 7 --remove-label halted');
    const none = fake(() => '');
    new GhTrackerHalt(none.run).clear();
    expect(none.calls.some(c => c.includes('--remove-label'))).toBe(false);
  });

  test('read reports the label and the last comment as the reason', () => {
    const f = fake(cmd => {
      if (cmd.startsWith('gh issue list')) return '7\n';
      if (cmd.includes('--json labels')) return 'P3\nhalted\n';
      return 'owner stop\n';
    });
    expect(new GhTrackerHalt(f.run).read()).toEqual({label: true, reason: 'owner stop'});
  });

  test('read without the label is not halted', () => {
    const f = fake(cmd => (cmd.startsWith('gh issue list') ? '7' : cmd.includes('--json labels') ? 'P3' : ''));
    expect(new GhTrackerHalt(f.run).read()).toEqual({label: false, reason: null});
  });

  test('a failing gh reads as not halted', () => {
    const f = fake(() => {
      throw new Error('network');
    });
    expect(new GhTrackerHalt(f.run).read()).toEqual({label: false, reason: null});
  });

  test('reads are cached until the TTL, and a removed label is seen after it', () => {
    let t = 0;
    let labels = 'halted';
    const f = fake(cmd => (cmd.startsWith('gh issue list') ? '7' : cmd.includes('--json labels') ? labels : ''));
    const h = new GhTrackerHalt(f.run, () => t);
    expect(h.read().label).toBe(true);
    const n = f.calls.length;
    labels = '';
    expect(h.read().label).toBe(true);
    expect(f.calls.length).toBe(n);
    t = HALT_READ_TTL_MS + 1;
    expect(h.read().label).toBe(false);
  });

  test('writeStatus edits the body', () => {
    const f = fake(cmd => (cmd.startsWith('gh issue list') ? '7' : ''));
    new GhTrackerHalt(f.run).writeStatus('hello');
    expect(f.calls).toContain("gh issue edit 7 --body 'hello'");
  });
});
