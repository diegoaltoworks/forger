/**
 * The outcome of one worker run, decided from facts about the repo rather than
 * from the worker's exit code or its own completion claim. A run that merged
 * and then timed out did its job; a run that claimed completion and merged
 * nothing did not. Pure: the engine gathers the facts (see run-facts.ts) and
 * applies the decision.
 */

import type {Claim} from './claim';
import type {TerminalEventKind} from './events';
import type {PrFact} from './pr-checks';
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
  /** The ticket the engine handed the worker; null when it had none. */
  enginePick: string | null;
  /** The ticket a decline record names; null when the worker declined nothing. */
  declined: string | null;
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
  /** The platform failed the run (login, billing, network); null if it did not. */
  infraError: string | null;
  /** The worker's PR and its CI result; null when there is none to read. */
  pr: PrFact | null;
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
  /** The terminal event the halt is recorded as; the runner's default when absent. */
  haltKind?: TerminalEventKind;
}

/**
 * Why a merge counts as red: read after the run, the merged PR's checks failed
 * or are still running, so it merged before CI had passed. Null for a green
 * merge, or when there is no PR to read.
 */
export function redMerge(pr: PrFact | null, baseBranch: string): string | null {
  if (!pr || pr.checks_ok) return null;
  const why =
    pr.checks === 'failure'
      ? `failing check${pr.failing_checks.length === 1 ? '' : 's'}: ${pr.failing_checks.join(', ') || 'unnamed'}`
      : 'checks still pending';
  return `PR #${pr.number} merged into ${baseBranch} with ${why}. ${baseBranch} may be red; fix it before more work lands.`;
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

/** A run that built a ticket other than the engine's pick. */
export function offPick(f: RunFacts): boolean {
  return f.enginePick !== null && f.ticket !== null && f.ticket !== f.enginePick;
}

export function decideOutcome(f: RunFacts): Outcome {
  const red = f.merged ? redMerge(f.pr, f.baseBranch) : null;
  if (red) {
    return {status: 'merged-red', result: 'failure', merged: true, error: red, warning: null, halt: red, haltKind: 'merged_red'};
  }

  // The pick is the contract: work on another ticket is real but is never the
  // pick's completion, even when its own PR merged. The decline record is
  // still honoured, so the pick leaves the queue either way.
  if (offPick(f)) {
    const declinedNote =
      f.declined === f.enginePick ? ` The pick "${f.enginePick}" was declined on the record.` : '';
    return {
      status: 'off-pick',
      result: 'failure',
      merged: f.merged,
      error: `Built "${f.ticket}" but the engine picked "${f.enginePick}".${declinedNote}`,
      warning: null,
      halt: null,
    };
  }

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

  // Not the worker's fault, so it neither counts as a failure nor a verdict on
  // the ticket: stop once, say why, and let a human fix the platform.
  if (f.infraError) {
    return {
      status: 'error',
      result: 'neutral',
      merged: false,
      error: f.infraError,
      warning: null,
      halt: f.infraError,
    };
  }

  // A decline for the pick, with nothing built, is the sanctioned exit from it.
  // It must come before the stop claim the worker ends a decline with.
  if (!f.merged && f.branch === null && f.declined !== null && f.declined === f.enginePick) {
    const why = `Declined "${f.declined}" on the record`;
    return {status: 'declined', result: 'neutral', merged: false, error: why, warning: null, halt: null};
  }

  if (f.declined !== null && f.declined !== f.enginePick && f.branch === null) {
    return failure(
      'failed',
      `Declined "${f.declined}" but the engine picked "${f.enginePick ?? 'none'}"; the record is not for this run's pick`
    );
  }

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
