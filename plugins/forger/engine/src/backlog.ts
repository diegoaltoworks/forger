/**
 * Backlog selection. These are the decisions that decide what the loop does
 * next - which ticket is workable, how much is left, what model/budget a ticket
 * gets - and they are all pure functions over a parsed backlog plus the config.
 * The runner does the file I/O and hands the parsed object in, so every rule
 * here is unit-testable without a filesystem.
 */

import type {Tier, WorkloopConfig} from './config';

export interface PRDFeature {
  status: string;
  priority?: string;
  /** Tracker issue number (GitHub) this ticket is published as. Set when config.tracker.kind is `github`. */
  issue?: number;
  /** Ticket ids that must be `completed` before this one can start. */
  depends_on?: string[];
  /** If set and not config.repo, this loop tracks but does not work it. */
  repo?: string;
  /** Declared size; scales the budget via config.effort_multiplier. */
  effort?: string;
  [key: string]: unknown;
}

export interface PRD {
  features: Record<string, PRDFeature | unknown>;
  [key: string]: unknown;
}

const PRIORITY_ORDER: Record<string, number> = {P0: 0, P1: 1, P2: 2, P3: 3};

/** A ticket belongs to this loop if it has no `repo` or matches config.repo. */
export function isThisRepo(feature: PRDFeature, config: WorkloopConfig): boolean {
  if (!feature.repo) return true;
  if (!config.repo) return true;
  return feature.repo === config.repo;
}

function features(prd: PRD | null): Record<string, PRDFeature> {
  const raw = prd?.features;
  if (!raw || typeof raw !== 'object') return {};
  return raw as Record<string, PRDFeature>;
}

function isObjectFeature(data: unknown): data is PRDFeature {
  return typeof data === 'object' && data !== null;
}

/**
 * Tickets this loop can actually start now: not started, in this repo, and with
 * every dependency completed - sorted by priority. The runner and the worker
 * command must agree on this, or stall detection counts tickets nobody can
 * start.
 */
export function workableTasks(
  prd: PRD | null,
  config: WorkloopConfig
): Array<{priority: number; name: string}> {
  const feats = features(prd);
  const isCompleted = (id: string): boolean => feats[id]?.status === 'completed';

  const candidates: Array<{priority: number; name: string}> = [];
  for (const [name, data] of Object.entries(feats)) {
    if (!isObjectFeature(data)) continue;
    if (data.status !== 'not_started') continue;
    if (!isThisRepo(data, config)) continue;

    const deps = Array.isArray(data.depends_on) ? data.depends_on : [];
    if (!deps.every(isCompleted)) continue;

    candidates.push({priority: PRIORITY_ORDER[data.priority || 'P3'] ?? 3, name});
  }

  candidates.sort((a, b) => a.priority - b.priority);
  return candidates;
}

/**
 * Total unfinished work in this repo, ignoring whether dependencies are met.
 * Stall detection and the "all done" exit key off this, NOT the workable count:
 * with a linear dependency chain the workable count sits at 1 indefinitely,
 * which would read as no progress and halt a healthy loop.
 */
export function remainingTasks(prd: PRD | null, config: WorkloopConfig): number {
  return Object.values(features(prd)).filter(
    f => isObjectFeature(f) && f.status === 'not_started' && isThisRepo(f, config)
  ).length;
}

export function workableCount(prd: PRD | null, config: WorkloopConfig): number {
  return workableTasks(prd, config).length;
}

export function nextTaskName(prd: PRD | null, config: WorkloopConfig): string | null {
  return workableTasks(prd, config)[0]?.name ?? null;
}

/** Model and budget for a ticket, by priority and scaled by declared effort. */
export function tierFor(
  prd: PRD | null,
  config: WorkloopConfig,
  taskName: string | null
): Tier {
  const mbp = config.model_by_priority;
  if (!taskName) return mbp.default;
  const feature = features(prd)[taskName];
  const priority = typeof feature?.priority === 'string' ? feature.priority : '';
  const tier = mbp[priority] ?? mbp.default;
  const effort = typeof feature?.effort === 'string' ? feature.effort : '';
  const multiplier = config.effort_multiplier[effort] ?? 1;
  return {model: tier.model, budget: tier.budget * multiplier};
}

export function isTicketCompleted(prd: PRD | null, taskName: string): boolean {
  return features(prd)[taskName]?.status === 'completed';
}

export function hasTicket(prd: PRD | null, taskName: string): boolean {
  return isObjectFeature(features(prd)[taskName]);
}
