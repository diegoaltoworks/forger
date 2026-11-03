import {describe, expect, test} from 'bun:test';

import {defaultState, endRun, migrateState, stallUpdate, startRun, updateRun} from './state';

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

describe('migrateState', () => {
  const legacy = {
    iteration: 7,
    status: 'running',
    started_at: '2026-01-01T00:00:00.000Z',
    completed_iterations: 3,
    consecutive_failures: 1,
    completed_tasks: ['a'],
    current_task: 'b',
    session_id: 'sess',
    stall_count: 2,
    snapshot: {baseSha: 'abc', reflogLength: 4},
  };

  test('an open run in the old shape reads as one in-flight run', () => {
    const s = migrateState(legacy);
    expect(s.in_flight).toEqual([
      {ticket: 'b', pid: null, session_id: 'sess', snapshot: {baseSha: 'abc', reflogLength: 4}, started_at: '2026-01-01T00:00:00.000Z'},
    ]);
    expect(s.stall_count).toBe(2);
    expect(s.completed_tasks).toEqual(['a']);
  });

  test.each([
    ['current_task'],
    ['session_id'],
    ['snapshot'],
    ['started_at'],
  ])('drops the old %s field', field => {
    expect(field in migrateState(legacy)).toBe(false);
  });

  test('a settled state in the old shape has no run in flight', () => {
    expect(migrateState({...legacy, status: 'completed'}).in_flight).toEqual([]);
  });

  test('an old running state with no ticket still reads as one run', () => {
    const s = migrateState({status: 'running'});
    expect(s.in_flight).toEqual([{ticket: null, pid: null, session_id: '', snapshot: null, started_at: ''}]);
  });

  test('the new shape is kept as stored', () => {
    const run = {ticket: 'x', pid: 9, session_id: 's', snapshot: null, started_at: 't'};
    expect(migrateState({status: 'running', in_flight: [run, {...run, ticket: 'y', session_id: 't'}]}).in_flight).toHaveLength(2);
  });

  test('unreadable input falls back to the default', () => {
    expect(migrateState(null)).toEqual(defaultState());
    expect(migrateState('x')).toEqual(defaultState());
  });
});

describe('run list helpers', () => {
  const run = (id: string) => ({ticket: id, pid: null, session_id: id, snapshot: null, started_at: ''});

  test('start, update and end act on one run by session', () => {
    const s = defaultState();
    startRun(s, run('a'));
    startRun(s, run('b'));
    updateRun(s, 'a', {pid: 5});
    expect(s.in_flight.map(r => [r.session_id, r.pid])).toEqual([
      ['a', 5],
      ['b', null],
    ]);
    endRun(s, 'a');
    expect(s.in_flight.map(r => r.session_id)).toEqual(['b']);
  });

  test('starting a session twice keeps one run', () => {
    const s = defaultState();
    startRun(s, run('a'));
    startRun(s, run('a'));
    expect(s.in_flight).toHaveLength(1);
  });
});
