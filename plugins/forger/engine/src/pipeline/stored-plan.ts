/**
 * The part of a resolved plan a run keeps (ADR 0016 section 5): which skill,
 * file or built-in step ran in which slot of which stage. Small enough for one
 * line of the iteration log, so `measure` reads it back from the file.
 */

import type {PipelinePlan} from './resolve';

export interface StoredSlot {
  slot: string;
  invoke: 'skill' | 'file' | 'builtin';
  target: string | null;
  on?: string;
}

export interface StoredStage {
  id: string;
  slots: StoredSlot[];
}

export interface StoredPlan {
  stages: StoredStage[];
}

/** The issue number a ticket id names (`issue-155`), or null for any other id. */
export function issueOfTicket(ticket: string | null): number | null {
  const m = ticket === null ? null : /^issue-(\d+)$/.exec(ticket);
  return m === null ? null : Number(m[1]);
}

export function storedPlan(plan: PipelinePlan): StoredPlan {
  return {
    stages: plan.stages.map(s => ({
      id: s.id,
      slots: s.slots.map(p => ({slot: p.slot, invoke: p.invoke, target: p.target, ...(p.on ? {on: p.on} : {})})),
    })),
  };
}

/** The log line value: one line of JSON. */
export function planLine(plan: StoredPlan): string {
  return JSON.stringify(plan);
}

/** Reads a log line value back; null when it is absent or not a stored plan (an older log). */
export function parsePlanLine(text: string | null): StoredPlan | null {
  if (text === null) return null;
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== 'object' || !Array.isArray((v as StoredPlan).stages)) return null;
    return v as StoredPlan;
  } catch {
    return null;
  }
}

/** One short line per stage that has slots: `build: test_first=file, diagnose=skill`. */
export function formatStoredPlan(plan: StoredPlan | null | undefined): string[] {
  if (!plan) return [];
  return plan.stages.filter(s => s.slots.length > 0).map(s => `${s.id}: ${s.slots.map(p => `${p.slot}=${p.invoke}${p.target && p.invoke !== 'builtin' ? ` ${p.target}` : ''}`).join(', ')}`);
}
