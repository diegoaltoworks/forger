/**
 * The worker's own account of its run, from the completion signal it prints.
 * It is a claim, not a fact: the outcome is decided from git (outcome.ts), and
 * the claim only adds a stop request and its reason.
 */

const DEFAULT_STOP_REASON = 'Agent signaled stop - blocked or no actionable work';
const MAX_REASON = 300;
const SIGNAL = /<process>(stop conflict|stop|complete)<\/process>/g;

export interface Claim {
  claim: 'complete' | 'stop' | null;
  stopReason: string | null;
  /** The text after a `stop conflict` tag, for the conflict parser; absent for any other claim. */
  conflictBlock?: string;
}

/**
 * The reason is only the paragraph right after the tag: searching the rest of
 * the output for a keyword picks up unrelated notes from the run's summary.
 */
function reasonAfter(rest: string): string {
  const paragraph = rest.split(/\r?\n[ \t]*\r?\n/)[0] ?? '';
  const text = paragraph
    .replace(/<process>(?:stop conflict|stop|complete)<\/process>[\s\S]*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:blocked|reason|because)\s*[:\-]?\s*/i, '')
    .trim();
  if (!text) return DEFAULT_STOP_REASON;
  return text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 3)}...` : text;
}

/** The last signal in the output is the claim: a worker may say stop early and then finish. */
export function parseClaim(output: string): Claim {
  const signals = [...output.matchAll(SIGNAL)];
  const last = signals.at(-1);
  if (!last) return {claim: null, stopReason: null};
  if (last[1] === 'complete') return {claim: 'complete', stopReason: null};
  const rest = output.slice((last.index ?? 0) + last[0].length);
  if (last[1] === 'stop conflict') return {claim: 'stop', stopReason: reasonAfter(rest), conflictBlock: rest};
  return {claim: 'stop', stopReason: reasonAfter(rest)};
}
