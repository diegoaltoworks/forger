/**
 * Read-only facts about the loop's checkout and its tracker, for a supervisor
 * that must never change the worker's working tree. Only `git fetch`,
 * `git rev-parse`, `git status` and `gh` reads are issued, all through the
 * injectable CommandRunner, so nothing here can move HEAD or touch files.
 */

import {dirtyEntries} from '../loop';
import type {CommandRunner} from '../ports';

/**
 * A PR's CI result. `none` means the repo has no CI configured, so the local
 * gates are the only assertion; checks not yet registered on a repo that has CI
 * are `pending`, never `none`.
 */
export type ChecksConclusion = 'success' | 'failure' | 'pending' | 'none';

export interface PrFact {
  number: number;
  state: string;
  merged: boolean;
  checks: ChecksConclusion;
  /** True when CI allows a merge: every check passed, or the repo has none. */
  checks_ok: boolean;
}

export interface IssueFact {
  number: number;
  state: string;
  closing_pr: PrFact | null;
}

export interface LoopFacts {
  branch: string | null;
  clean: boolean;
  base_branch: string;
  origin_base_head: string | null;
  issue?: IssueFact;
  pr?: PrFact;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The PR that closed or will close an issue, from `gh issue view --json
 * state,closedByPullRequestsReferences`. A merged PR wins over an open or
 * closed one; otherwise the newest. Null when none references the issue.
 */
export function closingPrNumber(issueJson: string): number | null {
  const parsed = parseJson(issueJson) as {closedByPullRequestsReferences?: {number?: number}[]} | null;
  const nums = (parsed?.closedByPullRequestsReferences ?? []).map(r => r.number).filter((n): n is number => typeof n === 'number');
  return nums.length === 0 ? null : Math.max(...nums);
}

interface RollupEntry {
  __typename?: string;
  status?: string | null;
  conclusion?: string | null;
  state?: string | null;
}

const PASSING = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

/**
 * Folds `gh pr view --json statusCheckRollup` into one conclusion. Check runs
 * carry `status` and `conclusion`; commit statuses carry `state`. Any failure
 * wins over pending, and pending over success.
 */
export function checksConclusion(rollup: unknown, ciConfigured: boolean): ChecksConclusion {
  const entries = Array.isArray(rollup) ? (rollup as RollupEntry[]) : [];
  if (entries.length === 0) return ciConfigured ? 'pending' : 'none';
  let pending = false;
  for (const e of entries) {
    const isStatus = e.__typename === 'StatusContext' || (e.state != null && e.status == null);
    if (isStatus) {
      const state = (e.state ?? '').toUpperCase();
      if (state === 'SUCCESS') continue;
      if (state === 'PENDING' || state === 'EXPECTED') pending = true;
      else return 'failure';
      continue;
    }
    if ((e.status ?? '').toUpperCase() !== 'COMPLETED') {
      pending = true;
      continue;
    }
    if (!PASSING.has((e.conclusion ?? '').toUpperCase())) return 'failure';
  }
  return pending ? 'pending' : 'success';
}

export function parsePr(prJson: string, ciConfigured = false): PrFact | null {
  const p = parseJson(prJson) as {number?: number; state?: string; mergedAt?: string | null; statusCheckRollup?: unknown} | null;
  if (!p || typeof p.number !== 'number' || typeof p.state !== 'string') return null;
  const checks = checksConclusion(p.statusCheckRollup, ciConfigured);
  return {number: p.number, state: p.state, merged: p.state === 'MERGED' || Boolean(p.mergedAt), checks, checks_ok: checks === 'success' || checks === 'none'};
}

const PR_FIELDS = 'number,state,mergedAt,statusCheckRollup';

export function gatherLoopFacts(
  run: CommandRunner,
  opts: {baseBranch: string; ignore: string[]; issue?: number; pr?: number}
): LoopFacts {
  const branch = run('git branch --show-current');
  run(`git fetch --quiet origin ${opts.baseBranch}`);
  const head = run(`git rev-parse origin/${opts.baseBranch}`);
  const facts: LoopFacts = {
    branch: branch === '' ? null : branch,
    clean: dirtyEntries(run('git status --porcelain'), opts.ignore).length === 0,
    base_branch: opts.baseBranch,
    origin_base_head: head === '' ? null : head,
  };
  if (opts.issue === undefined && opts.pr === undefined) return facts;
  // HEAD too: the PR that adds a repo's first workflow has CI before its base does.
  const ciConfigured = [`origin/${opts.baseBranch}`, 'HEAD'].some(ref => run(`git ls-tree -r --name-only ${ref} -- .github/workflows`).trim() !== '');
  const viewPr = (n: number) => parsePr(run(`gh pr view ${n} --json ${PR_FIELDS}`), ciConfigured);
  if (opts.issue !== undefined) {
    const issueJson = run(`gh issue view ${opts.issue} --json state,closedByPullRequestsReferences`);
    const state = (parseJson(issueJson) as {state?: string} | null)?.state ?? 'UNKNOWN';
    const prNumber = closingPrNumber(issueJson);
    facts.issue = {number: opts.issue, state, closing_pr: prNumber === null ? null : viewPr(prNumber)};
  }
  if (opts.pr !== undefined) facts.pr = viewPr(opts.pr) ?? undefined;
  return facts;
}

export function formatFacts(f: LoopFacts): string {
  const lines = [
    `branch: ${f.branch ?? 'detached'}`,
    `clean: ${f.clean ? 'yes' : 'no'}`,
    `origin/${f.base_branch}: ${f.origin_base_head ?? 'unknown'}`,
  ];
  const describePr = (pr: PrFact) => `PR #${pr.number} ${pr.merged ? 'merged' : pr.state.toLowerCase()}, checks ${pr.checks}`;
  if (f.issue) {
    const pr = f.issue.closing_pr;
    lines.push(`issue #${f.issue.number}: ${f.issue.state}, ${pr ? describePr(pr) : 'no PR'}`);
  }
  if (f.pr) lines.push(describePr(f.pr));
  return lines.join('\n');
}

/**
 * State-changing git commands a supervisor must never issue while a runner is
 * alive. Returns the offending lines of a prompt/doc body.
 */
const MUTATING = /\bgit\s+(checkout|switch|reset|stash|pull|commit|merge|rebase|restore|clean|cherry-pick|revert|am|apply)\b/;
export function mutatingGitLines(text: string): string[] {
  return text.split('\n').filter(l => MUTATING.test(l));
}
