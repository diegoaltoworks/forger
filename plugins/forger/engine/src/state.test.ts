import {describe, expect, test} from 'bun:test';

import {defaultState, stallUpdate} from './state';

describe('defaultState', () => {
  test('starts ready with empty history', () => {
    const s = defaultState();
    expect(s.status).toBe('ready');
    expect(s.iteration).toBe(0);
    expect(s.completed_tasks).toEqual([]);
    expect(s.last_remaining_count).toBeNull();
    expect(s.stall_count).toBe(0);
  });

  test('returns a fresh object each call', () => {
    const a = defaultState();
    a.completed_tasks.push('x');
    expect(defaultState().completed_tasks).toEqual([]);
  });
});

describe('stallUpdate', () => {
  test('first observation never stalls (no previous count)', () => {
    expect(stallUpdate(null, 0, 5, 3)).toEqual({stall_count: 0, stalled: false});
  });

  test('increments when the remaining count is unchanged', () => {
    expect(stallUpdate(5, 0, 5, 3)).toEqual({stall_count: 1, stalled: false});
    expect(stallUpdate(5, 1, 5, 3)).toEqual({stall_count: 2, stalled: false});
  });

  test('signals stalled once the counter reaches the max', () => {
    expect(stallUpdate(5, 2, 5, 3)).toEqual({stall_count: 3, stalled: true});
  });

  test('resets the moment the remaining count moves', () => {
    expect(stallUpdate(5, 2, 4, 3)).toEqual({stall_count: 0, stalled: false});
  });
});
