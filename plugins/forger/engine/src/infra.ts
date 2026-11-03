/**
 * Tells a worker that failed from a platform that failed it. An expired login,
 * an exhausted balance or a dead network ends every run the same way within
 * seconds; counting those as worker failures trips the consecutive-failure halt
 * for the wrong reason and hides the real one. Pure: the engine hands over the
 * exit code and the output.
 */

export type ExitClass =
  | {kind: 'worker'}
  | {kind: 'infrastructure'; category: 'authentication' | 'billing' | 'network'; reason: string};

interface Signature {
  category: 'authentication' | 'billing' | 'network';
  pattern: RegExp;
}

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
];

/**
 * A clean exit is never an infrastructure error, and a run that timed out is
 * the timeout's business: a worker can quote one of these messages while
 * reading a log, so the signature only counts on a failed exit.
 */
export function classifyExit(exitCode: number, output: string, timedOut: boolean): ExitClass {
  if (exitCode === 0 || timedOut) return {kind: 'worker'};
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
