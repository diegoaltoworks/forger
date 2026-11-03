/**
 * Merging a PR as a tool, so a worker cannot merge before CI has spoken: wait
 * until every check has finished, merge by squash only when all passed, and
 * confirm the merge from the PR's state rather than from gh's exit. The
 * decision is pure; the driver reads the PR through the injected runner.
 */

import type {CommandRunner} from '../ports';
import {ciConfigured, viewPr, type ChecksConclusion, type PrFact} from './pr-checks';

export type MergeStep = {action: 'wait'} | {action: 'merge'} | {action: 'refuse'; reason: string} | {action: 'done'};

export interface MergeResult {
  pr: number;
  merged: boolean;
  checks: ChecksConclusion | 'unknown';
  failing_checks: string[];
  /** Why the PR was not merged; null when it was. */
  reason: string | null;
}

/** What to do with a PR after waiting `waitedMs` of an allowed `timeoutMs`. */
export function mergeStep(pr: PrFact | null, waitedMs: number, timeoutMs: number): MergeStep {
  if (!pr) return {action: 'refuse', reason: 'cannot read the PR'};
  if (pr.merged) return {action: 'done'};
  if (pr.state !== 'OPEN') return {action: 'refuse', reason: `PR #${pr.number} is ${pr.state.toLowerCase()}`};
  if (pr.checks === 'failure') {
    return {action: 'refuse', reason: `failing checks: ${pr.failing_checks.join(', ') || 'unnamed'}`};
  }
  if (pr.checks === 'pending') {
    if (waitedMs >= timeoutMs) {
      return {action: 'refuse', reason: `checks still pending after ${Math.round(timeoutMs / 1000)}s`};
    }
    return {action: 'wait'};
  }
  return {action: 'merge'};
}

export interface MergeOptions {
  pr: number;
  baseBranch: string;
  timeoutMs: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

function result(prNumber: number, pr: PrFact | null, reason: string | null): MergeResult {
  return {
    pr: prNumber,
    merged: reason === null,
    checks: pr?.checks ?? 'unknown',
    failing_checks: pr?.failing_checks ?? [],
    reason,
  };
}

export async function mergePr(run: CommandRunner, opts: MergeOptions): Promise<MergeResult> {
  const pollMs = opts.pollMs ?? 10_000;
  const sleep = opts.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
  const ci = ciConfigured(run, opts.baseBranch);
  const read = () => viewPr(run, opts.pr, ci);

  for (let waited = 0; ; waited += pollMs) {
    const pr = read();
    const step = mergeStep(pr, waited, opts.timeoutMs);
    if (step.action === 'wait') {
      await sleep(pollMs);
      continue;
    }
    if (step.action === 'refuse') return result(opts.pr, pr, step.reason);
    if (step.action === 'done') return result(opts.pr, pr, null);

    run(`gh pr merge ${opts.pr} --squash --delete-branch`);
    const after = read();
    return result(opts.pr, after ?? pr, after?.merged ? null : `gh pr merge did not merge PR #${opts.pr}`);
  }
}
