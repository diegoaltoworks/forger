/**
 * What to do when a skill's result fails its contract (ADR 0016 section 2):
 * retry the same skill once with the problems shown, then the built-in step,
 * then a decline with reason `unclear`.
 */

export type ContractAction = 'retry' | 'builtin' | 'decline';

export interface ContractFailureStep {
  slot: string;
  /** The attempt that just failed, counting from 1. */
  attempt: number;
  action: ContractAction;
  /** Set on a decline. */
  reason?: 'unclear';
}

export function onContractFailure(attempt: number, slot: string): ContractFailureStep {
  if (attempt <= 1) return {slot, attempt, action: 'retry'};
  if (attempt === 2) return {slot, attempt, action: 'builtin'};
  return {slot, attempt, action: 'decline', reason: 'unclear'};
}

/** The text of the event that records one attempt. */
export function attemptReason(slot: string, attempt: number, problems: string[]): string {
  return problems.length === 0 ? `${slot} attempt ${attempt}: ok` : `${slot} attempt ${attempt}: ${problems.join('; ')}`;
}
