/**
 * The outcome of one worker run, decided from facts about the repo rather than
 * from the worker's exit code or its own completion claim. A run that merged
 * and then timed out did its job; a run that claimed completion and merged
 * nothing did not. Pure: the engine gathers the facts (see run-facts.ts) and
 * applies the decision.
 */

import type {Claim} from './claim';
import type {AutomationStatus} from './state';

export interface RunFacts {
  /** The base branch on the remote moved during the run. */
  merged: boolean;
  /** The branch the worker took exists on the remote. */
  pushed: boolean;
  /** The branch the worker took, from git; null if it never left base. */
  branch: string | null;
  /** The ticket the run is held to: the worker's, else the engine's pick. */
  ticket: string | null;
  /** What the worker's own completion signal said, if anything. */
  claim: Claim['claim'];
  stopReason: string | null;
  exitCode: number;
  signal: string | null;
  timedOut: boolean;
  timeoutMinutes: number;
  baseBranch: string;
  /** The ticket reads `completed` in the backlog. */
  backlogCompleted: boolean;
  /** Why the local checkout is not a clean, pushed base; null if it is. */
  unclean: string | null;
}

export interface Outcome {
  status: AutomationStatus;
  /** success resets the failure counter; neutral leaves it alone. */
  result: 'success' | 'failure' | 'neutral';
  /** A merge happened: the only thing that counts as progress. */
  merged: boolean;
  error: string | null;
  warning: string | null;
  halt: string | null;
}

function timeoutText(f: RunFacts): string {
  const by = f.signal ? `, ended by ${f.signal}` : '';
  return `Timeout after ${f.timeoutMinutes} minutes${by}`;
}

function divergence(f: RunFacts): string {
  const where = f.branch
    ? ` ${f.branch} is ${f.pushed ? 'pushed' : 'not pushed'}.`
    : '';
  return (
    `"${f.ticket}" reads completed in the backlog but nothing merged into ${f.baseBranch}.${where} ` +
    `The work is most likely finished on its branch and was cut off before it ` +
    `could be merged - recover it rather than re-running the ticket.`
  );
}

export function decideOutcome(f: RunFacts): Outcome {
  if (f.merged) {
    const notes: string[] = [];
    if (f.timedOut) notes.push('merged, then timed out');
    if (f.unclean) notes.push(f.unclean);
    return {
      status: 'completed',
      result: 'success',
      merged: true,
      error: null,
      warning: notes.length > 0 ? notes.join('; ') : null,
      halt: f.claim === 'stop' ? f.stopReason : null,
    };
  }

  const failure = (status: AutomationStatus, error: string): Outcome => ({
    status,
    result: 'failure',
    merged: false,
    error,
    warning: null,
    halt: null,
  });

  if (f.backlogCompleted && f.ticket) {
    const reason = divergence(f);
    return {...failure('failed', reason), halt: reason};
  }

  if (f.claim === 'stop') {
    return {
      status: 'halted',
      result: 'neutral',
      merged: false,
      error: f.stopReason,
      warning: null,
      halt: f.stopReason,
    };
  }

  const pushedNote = f.pushed && f.branch ? `${f.branch} pushed, not merged` : null;

  if (f.timedOut) {
    return failure('timeout', pushedNote ? `${timeoutText(f)}; ${pushedNote}` : timeoutText(f));
  }
  if (f.claim === 'complete') {
    return failure('failed', `Claimed complete but nothing merged into ${f.baseBranch}`);
  }
  if (pushedNote) return failure('partial', pushedNote);
  return failure('failed', `Nothing merged or pushed, exit code ${f.exitCode}`);
}
