/**
 * Gathers the git facts a run's outcome is decided from. A snapshot is taken
 * before the worker starts and compared after it ends:
 *
 * - merged: the PR for the worker's branch reads MERGED. Squash merges rewrite
 *   the SHA, so the branch's own commits never appear on base and git alone
 *   cannot tie a merge to a branch. Without a branch or a readable PR state,
 *   the fallback is the remote base branch having moved forward during the
 *   run; one engine works a repo at a time, so that move is the worker's.
 * - branch: read from the reflog entries written during the run, because a
 *   worker that merged usually deletes its branch and returns to base, leaving
 *   no other local trace of which ticket it took.
 * - pushed: the branch exists on the remote.
 * - pr: the branch's PR and its CI result, so a merge made on red checks is
 *   told from a green one.
 *
 * The parsers are pure; the git calls go through the injectable CommandRunner.
 */

import type {CommandRunner} from '../ports';
import {ciConfigured, viewPr, type PrFact} from './pr-checks';

export interface RunSnapshot {
  baseSha: string;
  reflogLength: number;
}

export interface GitRunFacts {
  merged: boolean;
  branch: string | null;
  pushed: boolean;
  pr: PrFact | null;
}

function lines(out: string): string[] {
  return out === '' ? [] : out.split('\n');
}

function remoteBase(run: CommandRunner, baseBranch: string): string {
  run(`git fetch --quiet origin ${baseBranch}`);
  return run(`git rev-parse origin/${baseBranch}`);
}

export function takeSnapshot(run: CommandRunner, baseBranch: string): RunSnapshot {
  return {
    baseSha: remoteBase(run, baseBranch),
    reflogLength: lines(run('git reflog --format=%gs')).length,
  };
}

/**
 * The last branch other than base that HEAD moved to, from reflog subjects
 * newest first. Null when the run never left base.
 */
export function branchFromReflog(subjects: string[], baseBranch: string): string | null {
  for (const s of subjects) {
    const m = s.match(/^checkout: moving from \S+ to (\S+)$/);
    if (m && m[1] !== baseBranch && !/^[0-9a-f]{7,40}$/.test(m[1])) return m[1];
  }
  return null;
}

/** The ticket id a branch names: `feat/<ticket>` -> `<ticket>`. */
export function ticketFromBranch(branch: string | null): string | null {
  if (!branch) return null;
  const id = branch.slice(branch.lastIndexOf('/') + 1);
  return id === '' ? null : id;
}

/** A known PR state is the authority; anything else falls back to base moving. */
export function mergedFrom(prState: string, baseMoved: boolean): boolean {
  if (prState === 'MERGED') return true;
  if (prState === 'OPEN' || prState === 'CLOSED') return false;
  return baseMoved;
}

export function gatherFacts(
  run: CommandRunner,
  baseBranch: string,
  before: RunSnapshot
): GitRunFacts {
  const after = remoteBase(run, baseBranch);
  const all = lines(run('git reflog --format=%gs'));
  const fresh = all.slice(0, Math.max(0, all.length - before.reflogLength));
  const current = run('git branch --show-current');
  const branch =
    branchFromReflog(fresh, baseBranch) ??
    (current !== '' && current !== baseBranch ? current : null);

  const pushed = branch !== null && run(`git ls-remote --heads origin ${branch}`) !== '';

  const pr = branch ? viewPr(run, branch, ciConfigured(run, baseBranch)) : null;
  const baseMoved =
    before.baseSha !== '' &&
    after !== '' &&
    after !== before.baseSha &&
    run(`git merge-base --is-ancestor ${before.baseSha} ${after} && echo yes`) === 'yes';

  return {merged: mergedFrom(pr?.state ?? '', baseMoved), branch, pushed, pr};
}
