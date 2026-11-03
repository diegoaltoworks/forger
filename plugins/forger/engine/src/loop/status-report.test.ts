import {describe, expect, test} from 'bun:test';

import {buildStatus} from './status-report';
import {defaultState} from './state';

describe('buildStatus', () => {
  test('has a stable shape', () => {
    const state = {
      ...defaultState(),
      iteration: 3,
      status: 'running' as const,
      current_task: 'a',
      stall_count: 1,
      consecutive_failures: 2,
      completed_iterations: 1,
      failed_iterations: 2,
    };
    expect(
      buildStatus({
        state,
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
      next_pick: 'b',
      remaining: 4,
      workable: 2,
      last_error: null,
      completed_tasks: [],
    });
  });

  test('a dead runner keeps its pid but is not alive; halt shows from either source', () => {
    const base = {
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
});
