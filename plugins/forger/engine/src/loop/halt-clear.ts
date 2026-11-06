/**
 * Why a halt was cleared. A halt a person clears names its cause (an issue that
 * fixes or tracks it) or says why it was not a defect; a clear with neither is
 * recorded as uncaused so the owner sees it. Pure over flag text and events.
 */

import type {TerminalEvent} from './events';

export interface HaltClearWhy {
  /** The issue that fixes, or tracks, what caused the halt. */
  cause: number | null;
  /** One line saying why the halt was not a defect. */
  notADefect: string | null;
}

export const UNCAUSED: HaltClearWhy = {cause: null, notADefect: null};

export const RESUME_FORMS = 'resume --cause <issue-number>  |  resume --not-a-defect "<why>"';

export type ParsedWhy = {ok: true; why: HaltClearWhy} | {ok: false; problem: string};

/** Exactly one of the two forms; anything else is refused with the reason. */
export function parseHaltClear(cause: string | undefined, notADefect: string | undefined): ParsedWhy {
  const hasCause = cause !== undefined;
  const hasReason = notADefect !== undefined;
  if (hasCause && hasReason) return {ok: false, problem: 'give --cause or --not-a-defect, not both'};
  if (!hasCause && !hasReason) return {ok: false, problem: 'resume needs a reason to clear the halt'};
  if (hasCause) {
    if (!/^#?\d+$/.test(cause.trim())) return {ok: false, problem: `--cause must be an issue number; got "${cause}"`};
    const n = parseInt(cause.trim().replace(/^#/, ''), 10);
    if (n < 1) return {ok: false, problem: `--cause must be an issue number; got "${cause}"`};
    return {ok: true, why: {cause: n, notADefect: null}};
  }
  const reason = (notADefect ?? '').trim();
  if (reason === '') return {ok: false, problem: '--not-a-defect needs a reason'};
  if (reason.includes('\n')) return {ok: false, problem: '--not-a-defect is one line'};
  return {ok: true, why: {cause: null, notADefect: reason}};
}

export interface HaltClearCounts {
  with_cause: number;
  not_a_defect: number;
  uncaused: number;
  /** Each not-a-defect reason with how often it was given, most frequent first. */
  reasons: {reason: string; count: number}[];
}

const cleared = (events: TerminalEvent[]): TerminalEvent[] => events.filter(e => e.event === 'halt_cleared');

export function haltClearCounts(events: TerminalEvent[]): HaltClearCounts {
  const out: HaltClearCounts = {with_cause: 0, not_a_defect: 0, uncaused: 0, reasons: []};
  const byReason = new Map<string, number>();
  for (const e of cleared(events)) {
    if (typeof e.cause === 'number') out.with_cause += 1;
    else if (typeof e.not_a_defect === 'string') {
      out.not_a_defect += 1;
      byReason.set(e.not_a_defect, (byReason.get(e.not_a_defect) ?? 0) + 1);
    } else out.uncaused += 1;
  }
  out.reasons = [...byReason.entries()].map(([reason, count]) => ({reason, count})).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  return out;
}

/** The clears with neither a cause nor a reason, oldest first. */
export function uncausedClears(events: TerminalEvent[]): TerminalEvent[] {
  return cleared(events).filter(e => typeof e.cause !== 'number' && typeof e.not_a_defect !== 'string');
}

export function formatHaltClears(c: HaltClearCounts): string[] {
  const lines = [`halts cleared: with a cause ${c.with_cause}, not a defect ${c.not_a_defect}, no reason ${c.uncaused}`];
  for (const r of c.reasons) lines.push(`  not a defect (${r.count}x): ${r.reason}`);
  return lines;
}
