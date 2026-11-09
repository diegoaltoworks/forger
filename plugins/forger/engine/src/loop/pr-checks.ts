/**
 * A PR's CI result, folded from `gh pr view --json statusCheckRollup`. The
 * engine reads it to tell a green merge from a red one, the `merge` command to
 * decide whether to merge, and the supervisor's facts to report it. Pure, apart
 * from `ciConfigured` and `viewPr`, which go through the injected runner.
 */

import type {CommandRunner} from '../ports';
import {VERIFY_STATUS_CONTEXT} from './verify-status';

/**
 * `none` means the repo has no CI configured, so the local gates are the only
 * assertion; checks not yet registered on a repo that has CI are `pending`,
 * never `none`.
 */
export type ChecksConclusion = 'success' | 'failure' | 'pending' | 'none';

export interface PrFact {
  number: number;
  state: string;
  merged: boolean;
  checks: ChecksConclusion;
  /** True when CI allows a merge: every check passed, or the repo has none. */
  checks_ok: boolean;
  /** The checks that failed, by name. */
  failing_checks: string[];
  /** The head commit the PR stands at; null when gh did not report it. */
  head: string | null;
  /** True when the head carries a `forger/verify` status of success, which only a passing `verify` sets. */
  verify_passed?: boolean;
}

interface RollupEntry {
  __typename?: string;
  name?: string | null;
  context?: string | null;
  status?: string | null;
  conclusion?: string | null;
  state?: string | null;
}

const PASSING = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

type EntryResult = 'passed' | 'pending' | 'failed';

/** Check runs carry `status` and `conclusion`; commit statuses carry `state`. */
function entryResult(e: RollupEntry): EntryResult {
  const isStatus = e.__typename === 'StatusContext' || (e.state != null && e.status == null);
  if (isStatus) {
    const state = (e.state ?? '').toUpperCase();
    if (state === 'SUCCESS') return 'passed';
    return state === 'PENDING' || state === 'EXPECTED' ? 'pending' : 'failed';
  }
  if ((e.status ?? '').toUpperCase() !== 'COMPLETED') return 'pending';
  return PASSING.has((e.conclusion ?? '').toUpperCase()) ? 'passed' : 'failed';
}

function entries(rollup: unknown): RollupEntry[] {
  return Array.isArray(rollup) ? (rollup as RollupEntry[]) : [];
}

/** Any failure wins over pending, and pending over success. */
export function checksConclusion(rollup: unknown, ciConfigured: boolean): ChecksConclusion {
  const all = entries(rollup);
  if (all.length === 0) return ciConfigured ? 'pending' : 'none';
  const results = all.map(entryResult);
  if (results.includes('failed')) return 'failure';
  return results.includes('pending') ? 'pending' : 'success';
}

/** Every check on the rollup with its outcome, by name. */
export function namedChecks(rollup: unknown): {name: string; result: EntryResult}[] {
  return entries(rollup).map(e => ({name: e.name ?? e.context ?? 'unnamed check', result: entryResult(e)}));
}

export function failingChecks(rollup: unknown): string[] {
  return entries(rollup)
    .filter(e => entryResult(e) === 'failed')
    .map(e => e.name ?? e.context ?? 'unnamed check');
}

/** The rollup lists the statuses of the PR head only, so a pass for an earlier head never shows here. */
export function verifyStatusPassed(rollup: unknown): boolean {
  return entries(rollup).some(e => e.context === VERIFY_STATUS_CONTEXT && entryResult(e) === 'passed');
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parsePr(prJson: string, ciConfigured = false): PrFact | null {
  const p = parseJson(prJson) as {number?: number; state?: string; mergedAt?: string | null; statusCheckRollup?: unknown; headRefOid?: string} | null;
  if (!p || typeof p.number !== 'number' || typeof p.state !== 'string') return null;
  const checks = checksConclusion(p.statusCheckRollup, ciConfigured);
  return {
    number: p.number,
    state: p.state,
    merged: p.state === 'MERGED' || Boolean(p.mergedAt),
    checks,
    checks_ok: checks === 'success' || checks === 'none',
    failing_checks: failingChecks(p.statusCheckRollup),
    head: typeof p.headRefOid === 'string' && p.headRefOid !== '' ? p.headRefOid : null,
    ...(verifyStatusPassed(p.statusCheckRollup) ? {verify_passed: true} : {}),
  };
}

export const PR_FIELDS = 'number,state,mergedAt,statusCheckRollup,headRefOid';

/** HEAD too: the PR that adds a repo's first workflow has CI before its base does. */
export function ciConfigured(run: CommandRunner, baseBranch: string): boolean {
  return [`origin/${baseBranch}`, 'HEAD'].some(ref => run(`git ls-tree -r --name-only ${ref} -- .github/workflows`).trim() !== '');
}

/** A PR by number or branch name; null when gh cannot read it. */
export function viewPr(run: CommandRunner, ref: number | string, ci: boolean): PrFact | null {
  return parsePr(run(`gh pr view ${ref} --json ${PR_FIELDS}`), ci);
}
