import {describe, expect, test} from 'bun:test';

import {mkdtempSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {StateStore} from '../ports';
import {defaultState, endRun, LoopStore, migrateState, stallUpdate, startRun, updateRun} from './state';

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

describe('migrateState plan', () => {
  test('an in-flight run stored without a plan reads as it was, and one with a plan keeps it', () => {
    const run = {ticket: 'a', pid: 1, session_id: 's', snapshot: null, started_at: 't'};
    const plan = {stages: []};
    const s = migrateState({in_flight: [run, {...run, session_id: 's2', plan}]});
    expect(s.in_flight[0].plan).toBeUndefined();
    expect(s.in_flight[1].plan).toEqual(plan);
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

describe('LoopStore with a tracker halt', () => {
  function setup(label: boolean) {
    const dir = mkdtempSync(join(tmpdir(), 'halt-'));
    const calls: string[] = [];
    let on = label;
    const tracker = {
      read: () => ({label: on, reason: on ? 'owner' : null}),
      set: (r: string) => {
        calls.push(`set:${r}`);
        on = true;
      },
      clear: () => {
        calls.push('clear');
        on = false;
      },
      writeStatus: (b: string) => calls.push(`status:${b.includes('Loop: halted') ? 'h' : 'r'}`),
    };
    const mem = {readState: () => null, writeState: () => {}} as unknown as StateStore;
    return {store: new LoopStore(mem, join(dir, 'HALT'), tracker), calls};
  }

  test('the label halts without a file', () => {
    expect(setup(true).store.isHalted()).toBe(true);
    expect(setup(false).store.isHalted()).toBe(false);
  });

  test('writeHalt writes the file and the label; clearHalt resumes', () => {
    const {store, calls} = setup(false);
    store.writeHalt('why');
    expect(store.haltFileExists()).toBe(false);
    expect(store.isHalted()).toBe(true);
    expect(calls).toEqual(['set:why']);
    store.clearHalt();
    expect(store.isHalted()).toBe(false);
    expect(calls).toEqual(['set:why', 'clear']);
  });

  test('removing the label alone resumes', () => {
    const {store} = setup(true);
    expect(store.isHalted()).toBe(true);
    const owner = setup(false);
    owner.store.writeHalt('why');
    expect(owner.store.isHalted()).toBe(true);
    owner.calls.length = 0;
    owner.store.clearHalt();
    expect(owner.store.isHalted()).toBe(false);
  });

  test('a tracker outage falls back to the local file', () => {
    const broken = new LoopStore({readState: () => null, writeState: () => {}} as unknown as StateStore, join(mkdtempSync(join(tmpdir(), 'halt-')), 'HALT'), {
      read: () => ({label: false, reason: null}),
      set: () => {
        throw new Error('down');
      },
      clear: () => {},
      writeStatus: () => {},
    });
    broken.writeHalt('x');
    expect(broken.isHalted()).toBe(true);
    broken.clearHalt();
    expect(broken.isHalted()).toBe(false);
  });

  test('publishStatus writes the generated body', () => {
    const {store, calls} = setup(false);
    store.publishStatus(defaultState());
    expect(calls).toEqual(['status:r']);
  });
});
