import {describe, expect, test} from 'bun:test';

import {linkBlockers} from './link-blockers';
import type {CommandRunner} from '../ports';

function fake(issues: Record<number, {id: string; body?: string; native?: number[]}>) {
  const calls: string[] = [];
  const run: CommandRunner = cmd => {
    calls.push(cmd);
    const m = cmd.match(/-F number=(\d+)/);
    if (m) {
      const i = issues[Number(m[1])];
      return JSON.stringify({
        data: {repository: {issue: i ? {id: i.id, body: i.body ?? '', blockedBy: {nodes: (i.native ?? []).map(number => ({number}))}} : null}},
      });
    }
    return '{}';
  };
  return {run, calls, mutations: () => calls.filter(c => c.includes('addBlockedBy'))};
}

describe('linkBlockers', () => {
  test('links each blocker the body names and nothing else', () => {
    const f = fake({
      7: {id: 'I7', body: '## Blocked by\n\n- #5\n- #6\n'},
      5: {id: 'I5'},
      6: {id: 'I6'},
    });
    expect(linkBlockers(f.run, 7)).toEqual({issue: 7, linked: [5, 6], already: []});
    expect(f.mutations()).toHaveLength(2);
    expect(f.mutations()[0]).toContain("-f issue='I7' -f blocker='I5'");
  });

  test('does not link what is already linked', () => {
    const f = fake({7: {id: 'I7', body: '## Blocked by\n#5\n#6', native: [5]}, 6: {id: 'I6'}});
    expect(linkBlockers(f.run, 7)).toEqual({issue: 7, linked: [6], already: [5]});
    expect(f.mutations()).toHaveLength(1);
  });

  test('None links nothing', () => {
    const f = fake({7: {id: 'I7', body: '## Blocked by\n\nNone'}});
    expect(linkBlockers(f.run, 7).linked).toEqual([]);
    expect(f.mutations()).toHaveLength(0);
  });

  test('a missing issue fails', () => {
    expect(() => linkBlockers(fake({}).run, 7)).toThrow(/not found/);
  });
});
