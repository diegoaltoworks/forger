/**
 * Loop state: the persisted record of where the automation is, plus the HALT
 * file that stops it. The store is thin I/O; the two decisions worth testing -
 * the default shape and stall detection - are pure and live here.
 */

import {existsSync, readFileSync, unlinkSync, writeFileSync} from 'fs';

import type {RunSnapshot} from './run-facts';

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
  stall_count: number;
  /** Git position when the open iteration began; closes out an orphan from facts. */
  snapshot: RunSnapshot | null;
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
    stall_count: 0,
    snapshot: null,
  };
}

/**
 * Decide the next stall counter and whether the loop has stalled. Progress is
 * a merge: counting the remaining tickets instead reads an iteration that
 * finished one ticket and adopted another as no progress. The counter resets
 * on any merge and stalls after `maxStall` runs in a row without one.
 */
export function stallUpdate(
  stallCount: number,
  merged: boolean,
  maxStall: number
): {stall_count: number; stalled: boolean} {
  if (merged) return {stall_count: 0, stalled: false};
  const next = (stallCount || 0) + 1;
  return {stall_count: next, stalled: next >= maxStall};
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
