/**
 * Tells a worker that failed from a platform that failed it. An expired login,
 * an exhausted balance or a dead network ends every run the same way within
 * seconds; counting those as worker failures trips the consecutive-failure halt
 * for the wrong reason and hides the real one. Pure: the engine hands over the
 * exit code and the output.
 */

export type InfraCategory = 'authentication' | 'billing' | 'network' | 'delivery' | 'limit';

export type ExitClass = {kind: 'worker'} | {kind: 'infrastructure'; category: InfraCategory; reason: string};

interface Signature {
  category: InfraCategory;
  pattern: RegExp;
}

const LIMIT = /forger: sandbox limit exceeded \((\w+ \S+)\)/;

const SIGNATURES: Signature[] = [
  {category: 'authentication', pattern: /invalid api key/i},
  {category: 'authentication', pattern: /please run \/login/i},
  {category: 'authentication', pattern: /oauth token (has )?(expired|revoked)/i},
  {category: 'authentication', pattern: /authentication[_ ](error|failed)/i},
  {category: 'authentication', pattern: /failed to authenticate/i},
  {category: 'authentication', pattern: /not logged in/i},
  {category: 'billing', pattern: /credit balance is too low/i},
  {category: 'billing', pattern: /usage limit reached/i},
  {category: 'billing', pattern: /billing[_ ]error/i},
  {category: 'billing', pattern: /payment required/i},
  {category: 'network', pattern: /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/},
  {category: 'network', pattern: /unable to connect to (the )?api/i},
  {category: 'network', pattern: /network (error|is unreachable)/i},
  {category: 'delivery', pattern: /no stdin data received/i},
  {category: 'delivery', pattern: /input must be provided either through stdin or as a prompt argument/i},
];

/**
 * A clean exit is never an infrastructure error, and a run that timed out is
 * the timeout's business: a worker can quote one of these messages while
 * reading a log, so the signature only counts on a failed exit. A prompt the
 * engine could not deliver (`inputError`) is the engine's failure, never the
 * ticket's.
 */
export function classifyExit(exitCode: number, output: string, timedOut: boolean, inputError: string | null = null): ExitClass {
  if (exitCode === 0 || timedOut) return {kind: 'worker'};
  if (inputError) {
    return {
      kind: 'infrastructure',
      category: 'delivery',
      reason: `Infrastructure error (delivery): the prompt did not reach the worker: ${inputError}`,
    };
  }
  const limit = LIMIT.exec(output);
  if (limit) {
    return {kind: 'infrastructure', category: 'limit', reason: `Infrastructure error (limit): the sandbox's ${limit[1]} limit was exceeded; raise sandbox_limits in the config, then resume`};
  }
  for (const {category, pattern} of SIGNATURES) {
    if (pattern.test(output)) {
      return {
        kind: 'infrastructure',
        category,
        reason: `Infrastructure error (${category}): fix it, then resume`,
      };
    }
  }
  return {kind: 'worker'};
}

/**
 * GitHub refusing a call for its rate limit, primary or secondary. Waiting is
 * the only fix, so it is told apart from every other gh failure.
 */
const RATE_LIMITED = /\b(?:secondary )?rate limit (?:already )?exceeded\b|\bAPI rate limit\b/i;

export function isRateLimited(stderr: string): boolean {
  return RATE_LIMITED.test(stderr);
}

/** One resource's budget from `gh api rate_limit`; `resetAt` is epoch milliseconds. */
export interface RateLimitWindow {
  resource: string;
  limit: number;
  remaining: number;
  resetAt: number;
}

/** The named resource from `gh api rate_limit` output, or null when unreadable. */
export function parseRateLimit(raw: string, resource: string): RateLimitWindow | null {
  try {
    const r = (JSON.parse(raw) as {resources?: Record<string, {limit?: unknown; remaining?: unknown; reset?: unknown}>})
      ?.resources?.[resource];
    if (!r || typeof r.limit !== 'number' || typeof r.remaining !== 'number' || typeof r.reset !== 'number') {
      return null;
    }
    return {resource, limit: r.limit, remaining: r.remaining, resetAt: r.reset * 1000};
  } catch {
    return null;
  }
}

/**
 * A rate-limited tracker read: an infrastructure error, not a worker failure
 * and never an empty backlog. Carries the reset so the runner can wait it out.
 */
export class RateLimitError extends Error {
  readonly category = 'rate_limit';
  constructor(
    readonly resource: string,
    readonly window: RateLimitWindow | null,
    readonly stderr: string
  ) {
    super(rateLimitReason(resource, window, stderr));
    this.name = 'RateLimitError';
  }
}

export function rateLimitReason(resource: string, window: RateLimitWindow | null, stderr: string): string {
  const limit = window ? `GitHub ${resource} rate limit (${window.limit} an hour)` : `GitHub ${resource} rate limit`;
  const reset = window ? `resets at ${new Date(window.resetAt).toISOString()}` : 'reset time unknown';
  return `Infrastructure error (rate_limit): ${limit} exhausted, ${reset}: ${stderr.trim()}`;
}

/** Past the reset by a margin for clock skew; an unknown reset waits the fallback. */
export const RATE_LIMIT_MARGIN_MS = 30_000;
export const RATE_LIMIT_FALLBACK_MS = 15 * 60_000;

export function rateLimitWaitMs(window: RateLimitWindow | null, now: number): number {
  if (!window) return RATE_LIMIT_FALLBACK_MS;
  return Math.max(0, window.resetAt - now) + RATE_LIMIT_MARGIN_MS;
}
