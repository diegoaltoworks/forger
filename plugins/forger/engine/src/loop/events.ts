/**
 * The terminal-event file: one JSON line appended per event a watcher cares
 * about, so a supervisor reads facts from a file instead of polling human
 * text. Append-only; a line is never rewritten.
 */

import {appendFileSync, existsSync, readFileSync} from 'fs';

export const TERMINAL_EVENTS = [
  'completed',
  'merged_red',
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

export function parseEvents(text: string): TerminalEvent[] {
  const out: TerminalEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const e = JSON.parse(line) as TerminalEvent;
      if ((TERMINAL_EVENTS as readonly string[]).includes(e.event)) out.push(e);
    } catch {
      // A torn line is not an event; the next read sees it whole.
    }
  }
  return out;
}

export function readEvents(file: string): TerminalEvent[] {
  return existsSync(file) ? parseEvents(readFileSync(file, 'utf-8')) : [];
}

/**
 * Resolve with the first event past `seen`, or null at the deadline. It reads
 * the event file, so there is no process pattern to match and nothing that can
 * match the watcher itself.
 */
export async function awaitEvent(
  file: string,
  seen: number,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
  pollMs = 1000
): Promise<TerminalEvent | null> {
  for (let waited = 0; waited <= timeoutMs; waited += pollMs) {
    const next = readEvents(file)[seen];
    if (next) return next;
    await sleep(pollMs);
  }
  return null;
}
