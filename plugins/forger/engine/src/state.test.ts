import {describe, expect, test} from 'bun:test';

import {defaultState, stallUpdate} from './state';

describe('defaultState', () => {
  test('starts ready with empty history', () => {
    const s = defaultState();
    expect(s.status).toBe('ready');
    expect(s.iteration).toBe(0);
    expect(s.completed_tasks).toEqual([]);
    expect(s.stall_count).toBe(0);
  });

  test('returns a fresh object each call', () => {
    const a = defaultState();
    a.completed_tasks.push('x');
    expect(defaultState().completed_tasks).toEqual([]);
  });
});

describe('stallUpdate', () => {
  test('increments on a run without a merge', () => {
    expect(stallUpdate(0, false, 3)).toEqual({stall_count: 1, stalled: false});
    expect(stallUpdate(1, false, 3)).toEqual({stall_count: 2, stalled: false});
  });

  test('signals stalled once the counter reaches the max', () => {
    expect(stallUpdate(2, false, 3)).toEqual({stall_count: 3, stalled: true});
  });

  test('resets on a merge, even with work adopted meanwhile', () => {
    expect(stallUpdate(2, true, 3)).toEqual({stall_count: 0, stalled: false});
  });
});
