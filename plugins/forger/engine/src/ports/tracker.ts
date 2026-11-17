/**
 * What the engine asks of a tracker about a ticket. A ticket is named by its
 * number. A read is a method; a write is data, so the decision to write is a
 * pure function that returns writes and no tracker is needed to test it.
 */

import type {CommandResult} from './command';

/** Where the queue of tickets is: in the tracker itself, or in a file. */
export type QueueHome = 'tracker' | 'file';

export type TrackerWrite =
  | {kind: 'file'; title: string; body: string; labels: string[]}
  | {kind: 'comment'; ticket: number; body: string}
  | {kind: 'labels'; ticket: number; add: string[]; remove: string[]}
  | {kind: 'body'; ticket: number; body: string}
  | {kind: 'pin'; ticket: number}
  | {kind: 'createLabel'; name: string; color: string; description: string}
  /** Makes `blocked` wait on `blocker`; both are the tracker's own references, as `links` hands them back. */
  | {kind: 'block'; blocked: string; blocker: string};

/** Where a ticket is in the loop: picked, its pull request verified, its pull request merged. */
export type StatusEvent = 'started' | 'review' | 'done';

export interface TicketFacts {
  labels: string[];
  body: string;
}

export interface TicketState {
  state: string;
  /** The pull requests that close the ticket, by number. */
  closedBy: number[];
}

export interface TicketQuery {
  state: 'open' | 'closed' | 'all';
  label?: string;
  /** Tickets whose title contains this text. */
  title?: string;
  limit?: number;
}

export interface TicketSummary {
  number: number;
  title: string;
}

/** Ask for the whole result of a call, so a failure is told from an empty answer; without it a failure is the runner's own. */
export interface WholeResult {
  whole: true;
}

/** A ticket with the fields a supervisor read needs. */
export interface TicketDetail extends TicketSummary {
  labels: string[];
  body: string;
}

/** An open ticket with its text and the numbers of its native blockers. */
export interface OpenTicket {
  number: number;
  body: string;
  /** Numbers of the native blocked-by issues. */
  native: number[];
}

/** A ticket's text and native blockers, with the tracker's own reference for it. */
export interface TicketLinks {
  /** What a block write names the ticket by; the port does not say what it is. */
  ref: string;
  body: string;
  native: number[];
}

/** What the tracker says about one ticket. `mergedPr` is set only when a merged PR closed it. */
export interface TicketFact {
  closed: boolean;
  mergedPr: number | null;
}

export interface Tracker {
  readonly queue: QueueHome;
  text(ticket: number): string;
  text(ticket: number, how: WholeResult): CommandResult;
  /** The ticket's labels and its text, in one read. */
  facts(ticket: number): TicketFacts;
  /** The ticket's title. */
  title(ticket: number): string;
  labels(ticket: number): string[];
  state(ticket: number): TicketState;
  lastComment(ticket: number): string;
  exists(ticket: number): boolean;
  list(query: TicketQuery): TicketSummary[];
  /** The tickets of a query with their labels and text. */
  tickets(query: TicketQuery): TicketDetail[];
  /** The open tickets with a label, each with its text and its native blockers, in one call; throws with the tracker's own error. */
  openTickets(label: string): OpenTicket[];
  /** One ticket's text, native blockers and reference, or null when there is no such ticket. */
  links(ticket: number): TicketLinks | null;
  /** Whether each ticket is closed and which merged pull request closed it, in one call; throws when the tracker cannot answer. */
  ticketFacts(tickets: number[]): ReadonlyMap<number, TicketFact>;
  /** What a person runs to list the tickets that carry a label. */
  listCommand(label: string): string;
  /** The labels the repository has. */
  repoLabels(): string[];
  /** The account the tracker acts as, such as the login that records a decision. */
  account(): string;
  account(how: WholeResult): CommandResult;
  /** Moves the ticket as the event says and returns a line to log for each move that could not be made; a tracker with no statuses does nothing. */
  moveStatus(ticket: number, event: StatusEvent, pr?: string): string[];
  /** Applies a write and returns what the tracker answered, such as the address of a filed ticket. */
  apply(write: TrackerWrite): string;
  apply(write: TrackerWrite, how: WholeResult): CommandResult;
}
