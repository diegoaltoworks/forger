import {describe, expect, test} from 'bun:test';

import {setAsideOnTracker} from './hand-over';

function tracker(labels: string, failOn?: string) {
  const commands: string[] = [];
  return {
    commands,
    run: (cmd: string): string => {
      commands.push(cmd);
      if (failOn && cmd.includes(failOn)) throw new Error('gh down');
      return cmd.includes('--json labels') ? labels : '';
    },
  };
}

describe('setAsideOnTracker', () => {
  test('labels the issue and posts the reason', () => {
    const t = tracker('ready-for-agent\n');
    expect(setAsideOnTracker(t.run, 5, "it's stuck", false)).toEqual([]);
    expect(t.commands).toContain('gh issue edit 5 --add-label needs-human');
    expect(t.commands.some(c => c.startsWith('gh issue comment 5 --body') && c.includes("it'\\''s stuck"))).toBe(true);
  });

  test('a ticket handover already labelled is not commented again, unless asked', () => {
    const quiet = tracker('needs-human\n');
    setAsideOnTracker(quiet.run, 5, 'x', false);
    expect(quiet.commands.some(c => c.includes('issue comment'))).toBe(false);
    const loud = tracker('needs-human\n');
    setAsideOnTracker(loud.run, 5, 'x', true);
    expect(loud.commands.some(c => c.includes('issue comment'))).toBe(true);
  });

  test('a tracker failure is returned, not thrown, and the other calls still run', () => {
    const t = tracker('', '--add-label');
    const problems = setAsideOnTracker(t.run, 5, 'x', false);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('gh down');
    expect(t.commands.some(c => c.includes('issue comment'))).toBe(true);
  });
});
