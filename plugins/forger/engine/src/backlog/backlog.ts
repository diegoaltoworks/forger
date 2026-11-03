/**
 * Backlog selection. These are the decisions that decide what the loop does
 * next - which ticket is workable, how much is left, what model/budget a ticket
 * gets - and they are all pure functions over the backlog's tickets plus the
 * config. Where the tickets come from is behind the Backlog interface; an
 * implementation only supplies a loader, so every rule here is unit-testable
 * without a filesystem or a tracker.
 */

import type {Tier, WorkloopConfig} from '../config';
import {parseFootprint, type Schedulable} from './schedule';

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
  /** The ticket text; its Knock-on section declares the footprint. */
  body?: string;
  /** Carries the `serial` label: runs alone (ADR 0011). */
  serial?: boolean;
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
): Array<{priority: number; label: string; name: string}> {
  const all = tickets(data);
  const isCompleted = (id: string): boolean => all[id]?.status === 'completed';

  const candidates: Array<{priority: number; label: string; name: string}> = [];
  for (const [name, ticket] of Object.entries(all)) {
    if (!isTicket(ticket)) continue;
    if (ticket.status !== 'not_started') continue;
    if (!isThisRepo(ticket, config)) continue;

    const deps = Array.isArray(ticket.depends_on) ? ticket.depends_on : [];
    if (!deps.every(isCompleted)) continue;

    const label = ticket.priority || 'P3';
    candidates.push({priority: PRIORITY_ORDER[label] ?? 3, label, name});
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

/** The workable tickets in the engine's order, each with the footprint its text declares. */
export function candidateTickets(data: BacklogData | null, config: WorkloopConfig): Schedulable[] {
  const all = tickets(data);
  return workableTasks(data, config).map(t => {
    const ticket = all[t.name];
    return {id: t.name, footprint: ticket?.body ? parseFootprint(ticket.body) : null, serial: ticket?.serial === true};
  });
}

/** Direct dependencies of every ticket, for following them transitively. */
export function dependencyGraph(data: BacklogData | null): Record<string, string[]> {
  const graph: Record<string, string[]> = {};
  for (const [id, ticket] of Object.entries(tickets(data))) {
    if (isTicket(ticket) && Array.isArray(ticket.depends_on)) graph[id] = ticket.depends_on;
  }
  return graph;
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

/**
 * What `backlog --json` prints: the workable tickets in order, what is left,
 * and the next pick. A ticket with no priority reads as P3, which is how it
 * is ordered; any other label is shown as written.
 */
export interface BacklogReport {
  workable: Array<{id: string; priority: string}>;
  remaining: number;
  next: string | null;
}

export function backlogReport(data: BacklogData | null, config: WorkloopConfig): BacklogReport {
  const workable = workableTasks(data, config).map(t => ({id: t.name, priority: t.label}));
  return {workable, remaining: remainingTasks(data, config), next: workable[0]?.id ?? null};
}

export function formatBacklogReport(report: BacklogReport): string {
  const lines = report.workable.map(t => `${t.priority} ${t.id}`);
  lines.push(`Remaining: ${report.remaining}  Next: ${report.next ?? 'none'}`);
  return lines.join('\n');
}

/**
 * The backlog as the runner sees it. The tickets are read on first use and
 * reused until `refresh()`, so one command or one iteration costs one read: a
 * tracker read spends rate limit, and the worker only changes statuses while
 * it runs, after which the runner refreshes.
 */
export interface Backlog {
  remaining(): number;
  workableCount(): number;
  next(): string | null;
  /** The workable tickets in order with their declared footprints, for the parallel scheduler. */
  candidates(): Schedulable[];
  /** Direct dependencies by ticket. */
  graph(): Record<string, string[]>;
  tier(ticket: string | null): Tier;
  isCompleted(ticket: string): boolean;
  has(ticket: string): boolean;
  report(): BacklogReport;
  /** Read the tickets now, replacing what was read before. */
  refresh(): void;
}

/** A Backlog over any loader; implementations differ only in where the tickets come from. */
export function backlogFrom(load: () => BacklogData | null, config: WorkloopConfig): Backlog {
  let read: {data: BacklogData | null} | null = null;
  const data = (): BacklogData | null => (read ??= {data: load()}).data;
  return {
    remaining: () => remainingTasks(data(), config),
    workableCount: () => workableCount(data(), config),
    next: () => nextTaskName(data(), config),
    candidates: () => candidateTickets(data(), config),
    graph: () => dependencyGraph(data()),
    tier: ticket => tierFor(data(), config, ticket),
    isCompleted: ticket => isTicketCompleted(data(), ticket),
    has: ticket => hasTicket(data(), ticket),
    report: () => backlogReport(data(), config),
    refresh: () => {
      read = {data: load()};
    },
  };
}
