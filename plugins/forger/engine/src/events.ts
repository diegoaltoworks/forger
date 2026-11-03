/**
 * The terminal-event file: one JSON line appended per event a watcher cares
 * about, so a supervisor reads facts from a file instead of polling human
 * text. Append-only; a line is never rewritten.
 */

import {appendFileSync} from 'fs';

export const TERMINAL_EVENTS = [
  'completed',
  'halted',
  'stalled',
  'timed_out',
  'too_many_failures',
  'runner_gone',
] as const;

export type TerminalEventKind = (typeof TERMINAL_EVENTS)[number];

export interface TerminalEvent {
  event: TerminalEventKind;
  at: string;
  iteration: number;
  ticket: string | null;
  reason: string | null;
}

export function terminalEvent(
  event: TerminalEventKind,
  iteration: number,
  ticket: string | null,
  reason: string | null,
  now: Date = new Date()
): TerminalEvent {
  return {event, at: now.toISOString(), iteration, ticket, reason};
}

export function eventLine(e: TerminalEvent): string {
  return `${JSON.stringify(e)}\n`;
}

export function appendEvent(file: string, e: TerminalEvent): void {
  appendFileSync(file, eventLine(e));
}
