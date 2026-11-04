import {describe, expect, test} from 'bun:test';

import {mergedPrOf, recommendationFor, recover, recoveryFor, standingHalt, type RecoveryPorts} from './recovery';
import {terminalEvent, type EventKind} from './events';

const ev = (k: EventKind, reason: string | null = null) => terminalEvent(k, 1, 't', reason, new Date('2026-01-01T00:00:00Z'));

function ports(decision: 'pass' | 'block' | 'unclear') {
  const calls: string[] = [];
  const p: RecoveryPorts = {
    verify: async pr => {
      calls.push(`verify ${pr}`);
      return {decision, open: decision === 'pass' ? [] : ['c1 cannot_tell']};
    },
    fileTicket: (title, body) => {
      calls.push(`file ${title} | ${body}`);
      return 'https://example/issues/9';
    },
    resume: d => calls.push(`resume ${d}`),
  };
  return {p, calls};
}

describe('recovery table', () => {
  test('only unverified is recovered by the engine; every other kind keeps the halt with one action', () => {
    expect(recoveryFor('unverified')).toEqual({action: 'verify_merged_head'});
    for (const k of ['merged_red', 'halted', 'stalled', 'timed_out', 'too_many_failures', 'runner_gone', 'unknown']) {
      const r = recoveryFor(k);
      expect(r.action).toBe('keep');
      expect(recommendationFor(k).length).toBeGreaterThan(0);
    }
  });
  test('a null kind gets the generic recommendation', () => {
    expect(recommendationFor(null)).toContain('halt reason');
  });
});

describe('standing halt', () => {
  test('is the last halting event with no clear or recovery after it', () => {
    expect(standingHalt([ev('unverified', 'PR #3 merged')])?.event).toBe('unverified');
    expect(standingHalt([ev('unverified'), ev('recovered')])).toBeNull();
    expect(standingHalt([ev('halted'), ev('halt_cleared'), ev('stalled')])?.event).toBe('stalled');
    expect(standingHalt([ev('completed')])).toBeNull();
  });
  test('reads the PR from the reason', () => {
    expect(mergedPrOf('PR #42 merged into main')).toBe(42);
    expect(mergedPrOf('Manual halt')).toBeNull();
  });
});

describe('recover', () => {
  test('a passing verdict resumes and says why', async () => {
    const {p, calls} = ports('pass');
    const r = await recover(ev('unverified', 'PR #7 merged into main with no verdict'), p);
    expect(r.recovered).toBe(true);
    expect(calls).toEqual(['verify 7', 'resume PR #7 verified after the merge: pass']);
  });
  test.each(['block', 'unclear'] as const)('a %s verdict keeps the halt and files the revert ticket', async d => {
    const {p, calls} = ports(d);
    const r = await recover(ev('unverified', 'PR #7 merged'), p);
    expect(r.recovered).toBe(false);
    expect(r.ticket).toBe('https://example/issues/9');
    expect(calls.some(c => c.startsWith('resume'))).toBe(false);
    expect(calls[1]).toContain(`verified ${d} after it merged`);
    expect(calls[1]).toContain('c1 cannot_tell');
  });
  test('another kind is neither verified nor resumed', async () => {
    const {p, calls} = ports('pass');
    const r = await recover(ev('merged_red', 'PR #7 red'), p);
    expect(r.recovered).toBe(false);
    expect(r.detail).toContain('resume');
    expect(calls).toEqual([]);
  });
  test('no halt, and an unverified halt naming no PR, recover nothing', async () => {
    const {p, calls} = ports('pass');
    expect((await recover(null, p)).kind).toBe('none');
    expect((await recover(ev('unverified', 'odd'), p)).recovered).toBe(false);
    expect(calls).toEqual([]);
  });
});
