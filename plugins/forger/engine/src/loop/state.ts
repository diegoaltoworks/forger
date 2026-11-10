/**
 * Loop state: the persisted record of where the automation is, plus the HALT
 * file that stops it. The store is thin I/O; the two decisions worth testing -
 * the default shape and stall detection - are pure and live here.
 */

import {existsSync, readFileSync, unlinkSync, writeFileSync} from 'fs';

import type {StateStore} from '../ports';
import type {StoredPlan} from '../pipeline';
import type {SetAsideEntry} from './aside/track';
import type {DeclineEntry} from './decline';
import {decideHalt, statusBody} from './halt-label';
import type {TrackerHalt} from './halt-tracker';
import type {RunSnapshot} from './run-facts';

export type AutomationStatus =
  | 'ready'
  | 'running'
  | 'completed'
  | 'owner-review'
  | 'merged-red'
  | 'unverified'
  | 'partial'
  | 'off-pick'
  | 'declined'
  | 'failed'
  | 'conflict'
  | 'set-aside'
  | 'timeout'
  | 'error'
  | 'halted';

/** One worker run that has started and not yet been settled. */
export interface InFlightRun {
  /** The ticket the run was started on; null when the engine had no pick. */
  ticket: string | null;
  /** The worker process, once known; null for a run read from the old shape. */
  pid: number | null;
  session_id: string;
  /** Git position when the run began; closes out an orphan from facts. */
  snapshot: RunSnapshot | null;
  started_at: string;
  /** The resolved pipeline plan the run started with; absent in a run stored before plans were kept. */
  plan?: StoredPlan | null;
}

export interface AutomationState {
  iteration: number;
  status: AutomationStatus;
  last_completed_at: string | null;
  completed_iterations: number;
  failed_iterations: number;
  consecutive_failures: number;
  completed_tasks: string[];
  /** Runs in progress, oldest first. Counters below stay global across them. */
  in_flight: InFlightRun[];
  last_error: string | null;
  stall_count: number;
  /** Recent runs the worker declined, oldest first. */
  declined_tasks: DeclineEntry[];
  /** Declined runs in a row; any other outcome ends the run. */
  consecutive_declines: number;
  /** Tickets whose PR is open for the owner to merge; absent in a state stored before the owner could review. */
  owner_review_tasks: string[];
  /** Tickets set aside in this run after a worker's stop, oldest first. */
  set_aside_tasks: SetAsideEntry[];
  /** Set-asides since the last merge. */
  consecutive_set_asides: number;
}

export function defaultState(): AutomationState {
  return {
    iteration: 0,
    status: 'ready',
    last_completed_at: null,
    completed_iterations: 0,
    failed_iterations: 0,
    consecutive_failures: 0,
    completed_tasks: [],
    in_flight: [],
    last_error: null,
    stall_count: 0,
    declined_tasks: [],
    consecutive_declines: 0,
    owner_review_tasks: [],
    set_aside_tasks: [],
    consecutive_set_asides: 0,
  };
}

/** The ticket of the oldest run in flight, for the places that name one. */
export function currentTicket(state: AutomationState): string | null {
  return state.in_flight[0]?.ticket ?? null;
}

export function startRun(state: AutomationState, run: InFlightRun): void {
  state.in_flight = [...state.in_flight.filter(r => r.session_id !== run.session_id), run];
}

export function updateRun(state: AutomationState, sessionId: string, patch: Partial<Omit<InFlightRun, 'session_id'>>): void {
  state.in_flight = state.in_flight.map(r => (r.session_id === sessionId ? {...r, ...patch} : r));
}

export function endRun(state: AutomationState, sessionId: string): void {
  state.in_flight = state.in_flight.filter(r => r.session_id !== sessionId);
}

const LEGACY_RUN_FIELDS = ['current_task', 'session_id', 'snapshot', 'started_at'] as const;

/**
 * Reads a stored state of either shape. The old shape held one run in
 * `current_task`, `session_id`, `snapshot` and `started_at`; it reads as one
 * in-flight run while the status is `running`, and as none otherwise (a
 * settled run left its fields behind only as stale values).
 */
export function migrateState(raw: unknown): AutomationState {
  const stored = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const merged = {...defaultState(), ...stored} as AutomationState & Record<string, unknown>;
  let inFlight: InFlightRun[];
  if (Array.isArray(stored.in_flight)) {
    inFlight = stored.in_flight as InFlightRun[];
  } else if (stored.status === 'running') {
    inFlight = [
      {
        ticket: typeof stored.current_task === 'string' ? stored.current_task : null,
        pid: null,
        session_id: typeof stored.session_id === 'string' ? stored.session_id : '',
        snapshot: (stored.snapshot as RunSnapshot | null | undefined) ?? null,
        started_at: typeof stored.started_at === 'string' ? stored.started_at : '',
      },
    ];
  } else {
    inFlight = [];
  }
  for (const field of LEGACY_RUN_FIELDS) delete merged[field];
  merged.in_flight = inFlight;
  return merged;
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

/** Reads and writes the loop state through the store, and the HALT file. */
export class LoopStore {
  constructor(
    private store: StateStore,
    private haltFile: string,
    private tracker: TrackerHalt | null = null
  ) {}

  load(): AutomationState {
    try {
      const text = this.store.readState();
      return text === null ? defaultState() : migrateState(JSON.parse(text));
    } catch {
      return defaultState();
    }
  }

  save(state: AutomationState): void {
    this.store.writeState(JSON.stringify(state, null, 2));
  }

  reset(): void {
    this.save(defaultState());
  }

  private haltFacts(): {label: boolean; labelReason: string | null; file: string | null} {
    const t = this.tracker?.read() ?? {label: false, reason: null};
    return {
      label: t.label,
      labelReason: t.reason,
      file: existsSync(this.haltFile) ? readFileSync(this.haltFile, 'utf-8') : null,
    };
  }

  isHalted(): boolean {
    return decideHalt(this.haltFacts()).halted;
  }

  /** True when only the local file halts, so `resume` knows what to remove. */
  haltFileExists(): boolean {
    return existsSync(this.haltFile);
  }

  /** With a tracker the label is the halt, so the owner resumes by removing it; the file is the fallback when the tracker cannot be written. */
  writeHalt(reason: string): void {
    if (this.tracker && this.trySet(this.tracker, reason)) return;
    writeFileSync(
      this.haltFile,
      `Halted: ${reason}\nTime: ${new Date().toISOString()}\n`
    );
  }

  /** True when the owner can resume by removing a tracker label. */
  hasTracker(): boolean {
    return this.tracker !== null;
  }

  private trySet(tracker: TrackerHalt, reason: string): boolean {
    try {
      tracker.set(reason);
      return true;
    } catch {
      return false;
    }
  }

  clearHalt(): void {
    if (existsSync(this.haltFile)) unlinkSync(this.haltFile);
    this.bestEffort(() => this.tracker?.clear());
  }

  /** Regenerates the pinned issue's body from state; the body is never read back. */
  publishStatus(state: AutomationState, now: Date = new Date()): void {
    const t = this.tracker;
    if (!t) return;
    const halted = this.isHalted() || state.status === 'halted';
    this.bestEffort(() => t.writeStatus(statusBody(state, halted, now)));
  }

  // The file is the per-machine switch and already written; a tracker outage must not undo it.
  private bestEffort(fn: () => void): void {
    try {
      fn();
    } catch {
      // see above
    }
  }
}
