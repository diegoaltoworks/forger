/**
 * The worker's own account of its run, from the completion signal it prints.
 * It is a claim, not a fact: the outcome is decided from git (outcome.ts), and
 * the claim only adds a stop request and its reason.
 */

const DEFAULT_STOP_REASON = 'Agent signaled stop - blocked or no actionable work';

export interface Claim {
  claim: 'complete' | 'stop' | null;
  stopReason: string | null;
}

export function parseClaim(output: string): Claim {
  if (output.includes('<process>stop</process>')) {
    const match = output.match(
      /<process>stop<\/process>[\s\S]*?(?:blocked|reason|because)[:\s]*([^\n]+)/i
    );
    return {claim: 'stop', stopReason: match ? match[1].trim() : DEFAULT_STOP_REASON};
  }
  if (output.includes('<process>complete</process>')) return {claim: 'complete', stopReason: null};
  return {claim: null, stopReason: null};
}
