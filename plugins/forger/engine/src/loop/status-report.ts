/**
 * The machine-readable status a supervisor acts on: runner liveness, halt,
 * counters, the current ticket and the next pick. Pure; the runner gathers the
 * inputs.
 */

import {declinedTickets, type DeclineReason} from './decline';
import type {AutomationState} from './state';

export interface StatusInputs {
  state: AutomationState;
  /** The pid in the lock file, if any. */
  runnerPid: number | null;
  runnerAlive: boolean;
  halted: boolean;
  remaining: number;
  workable: number;
  next: string | null;
  maxStallIterations: number;
  maxConsecutiveFailures: number;
}

export interface StatusReport {
  runner: {pid: number | null; alive: boolean};
  status: string;
  halted: boolean;
  iteration: number;
  counters: {
    completed: number;
    failed: number;
    consecutive_failures: number;
    max_consecutive_failures: number;
    stall_count: number;
    max_stall_iterations: number;
  };
  current_ticket: string | null;
  next_pick: string | null;
  remaining: number;
  workable: number;
  last_error: string | null;
  completed_tasks: string[];
  /** Tickets the worker declined, each with its latest reason. */
  declined: Array<{ticket: string; reason: DeclineReason}>;
}

export function buildStatus(i: StatusInputs): StatusReport {
  const s = i.state;
  return {
    runner: {pid: i.runnerPid, alive: i.runnerAlive},
    status: s.status,
    halted: i.halted || s.status === 'halted',
    iteration: s.iteration,
    counters: {
      completed: s.completed_iterations,
      failed: s.failed_iterations,
      consecutive_failures: s.consecutive_failures,
      max_consecutive_failures: i.maxConsecutiveFailures,
      stall_count: s.stall_count || 0,
      max_stall_iterations: i.maxStallIterations,
    },
    current_ticket: s.current_task,
    next_pick: i.next,
    remaining: i.remaining,
    workable: i.workable,
    last_error: s.last_error,
    completed_tasks: s.completed_tasks,
    declined: declinedTickets(s.declined_tasks ?? []),
  };
}
