/**
 * Read-only facts about the loop's checkout and its tracker, for a supervisor
 * that must never change the worker's working tree. Only `git fetch`,
 * `git rev-parse`, `git status` and `gh` reads are issued, all through the
 * injectable CommandRunner, so nothing here can move HEAD or touch files.
 */

import {ciConfigured as hasCi, dirtyEntries, viewPr as readPr, type PrFact} from '../loop';
import type {CommandRunner} from '../ports';

export {checksConclusion, parsePr, type ChecksConclusion, type PrFact} from '../loop';

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
  const ci = hasCi(run, opts.baseBranch);
  const viewPr = (n: number) => readPr(run, n, ci);
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
