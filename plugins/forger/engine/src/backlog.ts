/**
 * Backlog selection. These are the decisions that decide what the loop does
 * next - which ticket is workable, how much is left, what model/budget a ticket
 * gets - and they are all pure functions over the backlog's tickets plus the
 * config. Where the tickets come from is behind the Backlog interface; an
 * implementation only supplies a loader, so every rule here is unit-testable
 * without a filesystem or a tracker.
 */

import type {Tier, WorkloopConfig} from './config';

export interface Ticket {
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

/** The tickets as loaded, keyed by ticket id. The file keeps the `features` key. */
export interface BacklogData {
  features: Record<string, Ticket | unknown>;
  [key: string]: unknown;
}

const PRIORITY_ORDER: Record<string, number> = {P0: 0, P1: 1, P2: 2, P3: 3};

/** A ticket belongs to this loop if it has no `repo` or matches config.repo. */
export function isThisRepo(ticket: Ticket, config: WorkloopConfig): boolean {
  if (!ticket.repo) return true;
  if (!config.repo) return true;
  return ticket.repo === config.repo;
}

function tickets(data: BacklogData | null): Record<string, Ticket> {
  const raw = data?.features;
  if (!raw || typeof raw !== 'object') return {};
  return raw as Record<string, Ticket>;
}

function isTicket(data: unknown): data is Ticket {
  return typeof data === 'object' && data !== null;
}

/**
 * Tickets this loop can actually start now: not started, in this repo, and with
 * every dependency completed - sorted by priority. The runner and the worker
 * command must agree on this, or stall detection counts tickets nobody can
 * start.
 */
export function workableTasks(
  data: BacklogData | null,
  config: WorkloopConfig
): Array<{priority: number; name: string}> {
  const all = tickets(data);
  const isCompleted = (id: string): boolean => all[id]?.status === 'completed';

  const candidates: Array<{priority: number; name: string}> = [];
  for (const [name, ticket] of Object.entries(all)) {
    if (!isTicket(ticket)) continue;
    if (ticket.status !== 'not_started') continue;
    if (!isThisRepo(ticket, config)) continue;

    const deps = Array.isArray(ticket.depends_on) ? ticket.depends_on : [];
    if (!deps.every(isCompleted)) continue;

    candidates.push({priority: PRIORITY_ORDER[ticket.priority || 'P3'] ?? 3, name});
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
export function remainingTasks(data: BacklogData | null, config: WorkloopConfig): number {
  return Object.values(tickets(data)).filter(
    f => isTicket(f) && f.status === 'not_started' && isThisRepo(f, config)
  ).length;
}

export function workableCount(data: BacklogData | null, config: WorkloopConfig): number {
  return workableTasks(data, config).length;
}

export function nextTaskName(data: BacklogData | null, config: WorkloopConfig): string | null {
  return workableTasks(data, config)[0]?.name ?? null;
}

/** Model and budget for a ticket, by priority and scaled by declared effort. */
export function tierFor(
  data: BacklogData | null,
  config: WorkloopConfig,
  taskName: string | null
): Tier {
  const mbp = config.model_by_priority;
  if (!taskName) return mbp.default;
  const ticket = tickets(data)[taskName];
  const priority = typeof ticket?.priority === 'string' ? ticket.priority : '';
  const tier = mbp[priority] ?? mbp.default;
  const effort = typeof ticket?.effort === 'string' ? ticket.effort : '';
  const multiplier = config.effort_multiplier[effort] ?? 1;
  return {model: tier.model, budget: tier.budget * multiplier};
}

export function isTicketCompleted(data: BacklogData | null, taskName: string): boolean {
  return tickets(data)[taskName]?.status === 'completed';
}

export function hasTicket(data: BacklogData | null, taskName: string): boolean {
  return isTicket(tickets(data)[taskName]);
}

/** What `backlog --json` prints: the workable tickets in order, what is left, and the next pick. */
export interface BacklogReport {
  workable: Array<{id: string; priority: string}>;
  remaining: number;
  next: string | null;
}

export function backlogReport(data: BacklogData | null, config: WorkloopConfig): BacklogReport {
  const workable = workableTasks(data, config).map(t => ({id: t.name, priority: `P${t.priority}`}));
  return {workable, remaining: remainingTasks(data, config), next: workable[0]?.id ?? null};
}

/**
 * The backlog as the runner sees it. Every call reads afresh, because the
 * worker edits ticket statuses while the engine is running.
 */
export interface Backlog {
  remaining(): number;
  workableCount(): number;
  next(): string | null;
  tier(ticket: string | null): Tier;
  isCompleted(ticket: string): boolean;
  has(ticket: string): boolean;
  report(): BacklogReport;
}

/** A Backlog over any loader; implementations differ only in where the tickets come from. */
export function backlogFrom(load: () => BacklogData | null, config: WorkloopConfig): Backlog {
  return {
    remaining: () => remainingTasks(load(), config),
    workableCount: () => workableCount(load(), config),
    next: () => nextTaskName(load(), config),
    tier: ticket => tierFor(load(), config, ticket),
    isCompleted: ticket => isTicketCompleted(load(), ticket),
    has: ticket => hasTicket(load(), ticket),
    report: () => backlogReport(load(), config),
  };
}
