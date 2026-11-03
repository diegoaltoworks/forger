import {describe, expect, test} from 'bun:test';

import {LoopStore, defaultState} from '../loop';
import {memoryStateStore} from './memory-state-store';

const at = new Date('2026-01-01T00:00:00Z');
const req = (self: string, now = at) => ({self, host: 'h', ttlSeconds: 900, now});

describe('memoryStateStore', () => {
  test('drives the loop state', () => {
    const loop = new LoopStore(memoryStateStore(), '/nonexistent/HALT');
    expect(loop.load()).toEqual(defaultState());
    const s = defaultState();
    s.iteration = 7;
    loop.save(s);
    expect(loop.load().iteration).toBe(7);
  });

  test('events are kept in day order', () => {
    const m = memoryStateStore();
    m.appendEvent('{"b":1}', new Date('2026-01-02T00:00:00Z'));
    m.appendEvent('{"a":1}', at);
    expect(m.readEvents()).toBe('{"a":1}\n{"b":1}\n');
  });

  test('the lease follows decideLease', () => {
    const m = memoryStateStore();
    expect(m.claimLease(req('a')).ok).toBe(true);
    expect(m.claimLease(req('b'))).toMatchObject({ok: false, reason: 'held', holder: 'a'});
    expect(m.claimLease(req('b', new Date('2026-01-01T01:00:00Z')))).toMatchObject({action: 'takeover', previousHolder: 'a'});
  });
});
