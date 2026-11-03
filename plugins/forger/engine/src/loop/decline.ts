/**
 * Declining the engine's pick, as pure decisions: what a decline record must
 * hold, and how a run of declines turns into a halt. The tracker calls and the
 * record file live in `decline-io.ts`.
 */

export const DECLINE_REASONS = ['blocked', 'too-large', 'unclear'] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export interface DeclineRecord {
  ticket: string;
  reason: DeclineReason;
  detail: string;
  at: string;
}

/** One declined run, kept in the loop state so the report and the halt can name it. */
export interface DeclineEntry {
  ticket: string;
  reason: DeclineReason;
  iteration: number;
}

export type DeclineCheck = {ok: true; ticket: string; reason: DeclineReason; detail: string} | {ok: false; error: string};

export function isDeclineReason(s: unknown): s is DeclineReason {
  return typeof s === 'string' && (DECLINE_REASONS as readonly string[]).includes(s);
}

export function validateDecline(input: {ticket?: string; reason?: string; detail?: string}): DeclineCheck {
  const ticket = (input.ticket ?? '').trim();
  const detail = (input.detail ?? '').trim();
  if (ticket === '') return {ok: false, error: '--ticket is required'};
  if (!isDeclineReason(input.reason)) {
    return {ok: false, error: `--reason must be one of ${DECLINE_REASONS.join(', ')}; got "${input.reason ?? ''}"`};
  }
  if (detail === '') return {ok: false, error: '--detail is required: say what the owner must change'};
  return {ok: true, ticket, reason: input.reason, detail};
}

/** The issue number of an `issue-<n>` ticket; null for any other id. */
export function issueNumber(ticket: string): number | null {
  const m = ticket.match(/^issue-(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

/** A decline record from the file's text; null when it is missing or not a record. */
export function parseDeclineRecord(text: string): DeclineRecord | null {
  try {
    const r = JSON.parse(text) as Partial<DeclineRecord>;
    if (typeof r.ticket !== 'string' || r.ticket === '' || !isDeclineReason(r.reason)) return null;
    return {ticket: r.ticket, reason: r.reason, detail: String(r.detail ?? ''), at: String(r.at ?? '')};
  } catch {
    return null;
  }
}

/** Entries kept in the state; older ones no longer inform a report. */
export const DECLINE_HISTORY = 20;

export interface DeclineUpdate {
  declined_tasks: DeclineEntry[];
  consecutive_declines: number;
  /** Why the loop halts; null while the run of declines is short enough. */
  halt: string | null;
}

/**
 * Fold one finished run into the decline history. A declined run extends the
 * run of declines; any other outcome ends it. The loop halts when the run
 * reaches `max`, naming each ticket in it.
 */
export function declineUpdate(
  history: DeclineEntry[],
  consecutive: number,
  declined: DeclineEntry | null,
  max: number
): DeclineUpdate {
  if (!declined) return {declined_tasks: history, consecutive_declines: 0, halt: null};
  const declined_tasks = [...history, declined].slice(-DECLINE_HISTORY);
  const consecutive_declines = consecutive + 1;
  if (consecutive_declines < max) return {declined_tasks, consecutive_declines, halt: null};
  const run = declined_tasks.slice(-consecutive_declines).map(d => `${d.ticket} (${d.reason})`);
  return {
    declined_tasks,
    consecutive_declines,
    halt: `Declined ${consecutive_declines} tickets in a row: ${run.join(', ')}. The backlog holds work the loop cannot build; answer the issues and relabel them.`,
  };
}

/** The tickets the worker declined, each once with its latest reason. */
export function declinedTickets(history: DeclineEntry[]): Array<{ticket: string; reason: DeclineReason}> {
  const latest = new Map<string, DeclineReason>();
  for (const d of history) latest.set(d.ticket, d.reason);
  return [...latest].map(([ticket, reason]) => ({ticket, reason}));
}
