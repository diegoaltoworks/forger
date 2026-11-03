import {describe, expect, test} from 'bun:test';

import {buildStatus} from './status-report';
import {defaultState} from './state';

describe('buildStatus', () => {
  test('has a stable shape', () => {
    const state = {
      ...defaultState(),
      iteration: 3,
      status: 'running' as const,
      in_flight: [{ticket: 'a', pid: 91, session_id: 's1', snapshot: null, started_at: 't0'}],
      stall_count: 1,
      consecutive_failures: 2,
      completed_iterations: 1,
      failed_iterations: 2,
    };
    expect(
      buildStatus({
        state,
        isAlive: pid => pid === 91,
        runnerPid: 77,
        runnerAlive: true,
        halted: false,
        remaining: 4,
        workable: 2,
        next: 'b',
        maxStallIterations: 5,
        maxConsecutiveFailures: 3,
      })
    ).toEqual({
      runner: {pid: 77, alive: true},
      status: 'running',
      halted: false,
      iteration: 3,
      counters: {
        completed: 1,
        failed: 2,
        consecutive_failures: 2,
        max_consecutive_failures: 3,
        stall_count: 1,
        max_stall_iterations: 5,
      },
      current_ticket: 'a',
      in_flight: [{ticket: 'a', pid: 91, session_id: 's1', started_at: 't0', alive: true}],
      next_pick: 'b',
      remaining: 4,
      workable: 2,
      last_error: null,
      completed_tasks: [],
      declined: [],
    });
  });

  test('a dead runner keeps its pid but is not alive; halt shows from either source', () => {
    const base = {
      isAlive: () => false,
      runnerPid: 5,
      runnerAlive: false,
      remaining: 0,
      workable: 0,
      next: null,
      maxStallIterations: 5,
      maxConsecutiveFailures: 3,
    };
    const r = buildStatus({...base, state: defaultState(), halted: true});
    expect(r.runner).toEqual({pid: 5, alive: false});
    expect(r.halted).toBe(true);
    expect(buildStatus({...base, state: {...defaultState(), status: 'halted'}, halted: false}).halted).toBe(true);
  });

  describe('in-flight runs', () => {
    const base = {
      isAlive: (pid: number) => pid === 11,
      runnerPid: 5,
      runnerAlive: true,
      halted: false,
      remaining: 0,
      workable: 0,
      next: null,
      maxStallIterations: 5,
      maxConsecutiveFailures: 3,
    };
    const run = (ticket: string, pid: number | null) => ({ticket, pid, session_id: `s-${ticket}`, snapshot: null, started_at: 't'});

    test('zero runs: none listed and no current ticket', () => {
      const r = buildStatus({...base, state: defaultState()});
      expect(r.in_flight).toEqual([]);
      expect(r.current_ticket).toBeNull();
    });

    test('one run: listed with liveness', () => {
      const r = buildStatus({...base, state: {...defaultState(), in_flight: [run('a', 11)]}});
      expect(r.in_flight.map(x => [x.ticket, x.alive])).toEqual([['a', true]]);
      expect(r.current_ticket).toBe('a');
    });

    test('two runs: each reports its own liveness; a run without a pid is not alive; counters stay global', () => {
      const state = {...defaultState(), stall_count: 2, in_flight: [run('a', 11), run('b', 12), run('c', null)]};
      const r = buildStatus({...base, state});
      expect(r.in_flight.map(x => [x.ticket, x.alive])).toEqual([
        ['a', true],
        ['b', false],
        ['c', false],
      ]);
      expect(r.counters.stall_count).toBe(2);
    });
  });
});
