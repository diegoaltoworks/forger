/**
 * Loop state: the persisted record of where the automation is, plus the HALT
 * file that stops it. The store is thin I/O; the two decisions worth testing -
 * the default shape and stall detection - are pure and live here.
 */

import {existsSync, readFileSync, unlinkSync, writeFileSync} from 'fs';

export type AutomationStatus =
  | 'ready'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'timeout'
  | 'error'
  | 'halted';

export interface AutomationState {
  iteration: number;
  status: AutomationStatus;
  started_at: string | null;
  last_completed_at: string | null;
  completed_iterations: number;
  failed_iterations: number;
  consecutive_failures: number;
  completed_tasks: string[];
  current_task: string | null;
  last_error: string | null;
  session_id: string | null;
  last_remaining_count: number | null;
  stall_count: number;
}

export function defaultState(): AutomationState {
  return {
    iteration: 0,
    status: 'ready',
    started_at: null,
    last_completed_at: null,
    completed_iterations: 0,
    failed_iterations: 0,
    consecutive_failures: 0,
    completed_tasks: [],
    current_task: null,
    last_error: null,
    session_id: null,
    last_remaining_count: null,
    stall_count: 0,
  };
}

/**
 * Given the previous remaining count and stall counter, decide the next stall
 * counter and whether the loop has stalled. Stalled means the remaining count
 * has not moved for `maxStall` consecutive checks - a linear dependency chain
 * makes progress without the workable count changing, so this keys off the
 * remaining total, and resets the moment it moves.
 */
export function stallUpdate(
  lastRemaining: number | null,
  stallCount: number,
  remaining: number,
  maxStall: number
): {stall_count: number; stalled: boolean} {
  if (lastRemaining !== null && remaining === lastRemaining) {
    const next = (stallCount || 0) + 1;
    return {stall_count: next, stalled: next >= maxStall};
  }
  return {stall_count: 0, stalled: false};
}

/** Reads and writes the state file and the HALT file. */
export class StateStore {
  constructor(
    private stateFile: string,
    private haltFile: string
  ) {}

  load(): AutomationState {
    if (existsSync(this.stateFile)) {
      try {
        return JSON.parse(readFileSync(this.stateFile, 'utf-8')) as AutomationState;
      } catch {
        return defaultState();
      }
    }
    return defaultState();
  }

  save(state: AutomationState): void {
    writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
  }

  reset(): void {
    this.save(defaultState());
  }

  isHalted(): boolean {
    return existsSync(this.haltFile);
  }

  writeHalt(reason: string): void {
    writeFileSync(
      this.haltFile,
      `Halted: ${reason}\nTime: ${new Date().toISOString()}\n`
    );
  }

  clearHalt(): void {
    if (existsSync(this.haltFile)) unlinkSync(this.haltFile);
  }
}
