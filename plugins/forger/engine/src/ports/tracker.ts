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
  | {kind: 'createLabel'; name: string; color: string; description: string};

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

export interface Tracker {
  readonly queue: QueueHome;
  text(ticket: number): string;
  text(ticket: number, how: WholeResult): CommandResult;
  /** The ticket's labels and its text, in one read. */
  facts(ticket: number): TicketFacts;
  labels(ticket: number): string[];
  state(ticket: number): TicketState;
  lastComment(ticket: number): string;
  exists(ticket: number): boolean;
  list(query: TicketQuery): TicketSummary[];
  /** The labels the repository has. */
  repoLabels(): string[];
  /** Applies a write and returns what the tracker answered, such as the address of a filed ticket. */
  apply(write: TrackerWrite): string;
  apply(write: TrackerWrite, how: WholeResult): CommandResult;
}
