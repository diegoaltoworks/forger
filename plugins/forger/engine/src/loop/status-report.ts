/**
 * The machine-readable status a supervisor acts on: runner liveness, halt,
 * counters, the current ticket and the next pick. Pure; the runner gathers the
 * inputs.
 */

import {declinedTickets, type DeclineReason} from './decline';
import {currentTicket, type AutomationState} from './state';

export interface StatusInputs {
  state: AutomationState;
  /** Whether a pid is a live process; decides each run's liveness. */
  isAlive: (pid: number) => boolean;
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

export interface InFlightStatus {
  ticket: string | null;
  pid: number | null;
  session_id: string;
  started_at: string;
  /** False when the run has no known pid or the pid is gone. */
  alive: boolean;
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
  /** One entry per run in flight, oldest first. */
  in_flight: InFlightStatus[];
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
    current_ticket: currentTicket(s),
    in_flight: s.in_flight.map(r => ({
      ticket: r.ticket,
      pid: r.pid,
      session_id: r.session_id,
      started_at: r.started_at,
      alive: r.pid !== null && i.isAlive(r.pid),
    })),
    next_pick: i.next,
    remaining: i.remaining,
    workable: i.workable,
    last_error: s.last_error,
    completed_tasks: s.completed_tasks,
    declined: declinedTickets(s.declined_tasks ?? []),
  };
}
