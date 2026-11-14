/**
 * The terminal-event file: one JSON line appended per event a watcher cares
 * about, so a supervisor reads facts from a file instead of polling human
 * text. Append-only; a line is never rewritten.
 */

import {appendFileSync, existsSync, readFileSync} from 'fs';

export const TERMINAL_EVENTS = [
  'completed',
  'blocked_on_owner',
  'merged_red',
  'unverified',
  'halted',
  'stalled',
  'timed_out',
  'too_many_failures',
  'runner_gone',
] as const;

export type TerminalEventKind = (typeof TERMINAL_EVENTS)[number];

/**
 * Facts about the run that are not terminal: the pick, an approval asked, a
 * halt a person cleared and each attempt at a slot's output contract, a PR left open for the owner (`reason` carries the PR) and a ticket handed back by a failed probe (`reason` carries the command and its result), a ticket set aside after a worker's stop (`reason` carries why), a ticket merged (the count a structure review is due by) and a structure review or an access review filed (`reason` carries why), a gate that failed and passed on a rerun with no change (`reason` starts with the PR and names the check and the failed tests), and the outcome of a delivery after a merge (`reason` starts with the PR, as `PR #n: ...`). They
 * share the file, but the terminal readers (`readEvents`, `awaitEvent`) skip
 * them, so a watcher never wakes on one.
 * `reason` carries the detail: the action and its authority for an approval,
 * the cleared halt's reason for a clear, the previous holder for a lease
 * takeover, the slot, attempt and problems for a contract attempt.
 */
export const RECORDED_EVENTS = ['picked', 'approval_asked', 'halt_cleared', 'lease_takeover', 'contract_attempt', 'owner_review', 'probe_failed', 'merged', 'structure_review_filed', 'access_review_filed', 'set_aside', 'delivered', 'delivery_failed', 'rolled_back', 'rollback_failed', 'flaky_gate'] as const;

export type RecordedEventKind = (typeof RECORDED_EVENTS)[number];

/**
 * Mid-run facts a watcher wakes on while the run continues: a worker's call
 * the hook refused (`reason` carries the rule and the refused command) and a
 * halt the engine recovered by itself (`reason` carries the check that passed),
 * and a `verify` or `merge` refused because the engine's source had uncommitted changes (`reason` carries the command and the paths).
 */
export const MIDRUN_EVENTS = ['worker_denied', 'recovered', 'engine_changed'] as const;

export type MidrunEventKind = (typeof MIDRUN_EVENTS)[number];

export type EventKind = TerminalEventKind | RecordedEventKind | MidrunEventKind;

export interface TerminalEvent {
  event: EventKind;
  at: string;
  iteration: number;
  ticket: string | null;
  reason: string | null;
  /** On `halt_cleared`: the issue that fixes or tracks the cause, when one was given. */
  cause?: number | null;
  /** On `halt_cleared`: why the halt was not a defect, when that was given. Both null marks an uncaused clear. */
  not_a_defect?: string | null;
  /** On `halt_cleared` by `decide`: the owner's answer, which cleared the halt. */
  decision?: string | null;
}

export function terminalEvent(
  event: EventKind,
  iteration: number,
  ticket: string | null,
  reason: string | null,
  now: Date = new Date(),
  extra: Pick<TerminalEvent, 'cause' | 'not_a_defect' | 'decision'> = {}
): TerminalEvent {
  return {event, at: now.toISOString(), iteration, ticket, reason, ...extra};
}

export function eventLine(e: TerminalEvent): string {
  return `${JSON.stringify(e)}\n`;
}

export function appendEvent(file: string, e: TerminalEvent): void {
  appendFileSync(file, eventLine(e));
}

export function parseEvents(text: string): TerminalEvent[] {
  return parseKinds(text, TERMINAL_EVENTS);
}

/** Every line the file holds: terminal, recorded and mid-run events alike. */
export function parseAllEvents(text: string): TerminalEvent[] {
  return parseKinds(text, [...TERMINAL_EVENTS, ...RECORDED_EVENTS, ...MIDRUN_EVENTS]);
}

/** What a watcher wakes on: terminal events and mid-run ones, in file order. */
export function parseWatchedEvents(text: string): TerminalEvent[] {
  return parseKinds(text, [...TERMINAL_EVENTS, ...MIDRUN_EVENTS]);
}

function parseKinds(text: string, kinds: readonly string[]): TerminalEvent[] {
  const out: TerminalEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const e = JSON.parse(line) as TerminalEvent;
      if (kinds.includes(e.event)) out.push(e);
    } catch {
      // A torn line is not an event; the next read sees it whole.
    }
  }
  return out;
}

export function readEvents(file: string): TerminalEvent[] {
  return existsSync(file) ? parseEvents(readFileSync(file, 'utf-8')) : [];
}

export function readAllEvents(file: string): TerminalEvent[] {
  return existsSync(file) ? parseAllEvents(readFileSync(file, 'utf-8')) : [];
}

/**
 * Resolve with the first event past `seen`, or null at the deadline. It reads
 * the events, so there is no process pattern to match and nothing that can
 * match the watcher itself. `events` is a file of terminal events, or a reader.
 */
export async function awaitEvent(
  events: string | (() => TerminalEvent[]),
  seen: number,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
  pollMs = 1000
): Promise<TerminalEvent | null> {
  for (let waited = 0; waited <= timeoutMs; waited += pollMs) {
    const next = (typeof events === 'string' ? readEvents(events) : events())[seen];
    if (next) return next;
    await sleep(pollMs);
  }
  return null;
}
