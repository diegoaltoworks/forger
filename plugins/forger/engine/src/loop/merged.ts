/**
 * The reality check on an iteration's completion claim. A completion signal is
 * the agent's own account; this verifies the repo actually landed on the base
 * branch, clean, and pushed. The git calls go through an injectable
 * CommandRunner so the branching logic is unit-testable with canned output -
 * squash merges rewrite the SHA, so where HEAD sits and whether base matches
 * its remote is the only reliable test.
 */

import type {CommandRunner} from '../ports';

/** Path part of one `git status --porcelain` line; the runner trims the first line's lead. */
function porcelainPath(line: string): string {
  const path = line.trimStart().replace(/^\S+\s+/, '');
  const target = path.includes(' -> ') ? path.split(' -> ').pop()! : path;
  return target.replace(/^"|"$/g, '').replace(/\/$/, '');
}

function isIgnored(path: string, ignore: string[]): boolean {
  return ignore.some(entry => {
    const e = entry.replace(/\/$/, '');
    return path === e || path.startsWith(`${e}/`);
  });
}

/**
 * The porcelain lines that are not under an ignored path. Files the engine
 * writes itself and files a project marks local-only are not the worker's mess.
 */
export function dirtyEntries(porcelain: string, ignore: string[]): string[] {
  return porcelain
    .split('\n')
    .filter(line => line.trim() !== '')
    .filter(line => !isIgnored(porcelainPath(line), ignore));
}

/**
 * Return a human-readable reason the working state is NOT a clean merged base,
 * or null if it is. Order matters: wrong branch, then dirty tree, then unpushed.
 */
export function verifyMerged(
  run: CommandRunner,
  baseBranch: string,
  ignore: string[] = []
): string | null {
  const branch = run('git branch --show-current');
  if (branch !== baseBranch) {
    return `HEAD is on "${branch || 'detached'}", not ${baseBranch}`;
  }

  if (dirtyEntries(run('git status --porcelain'), ignore).length > 0) return 'working tree is dirty';

  run(`git fetch --quiet origin ${baseBranch}`);
  const ahead = run(`git rev-list --count origin/${baseBranch}..${baseBranch}`);
  if (ahead !== '' && ahead !== '0') return `${baseBranch} is ${ahead} commit(s) unpushed`;

  return null;
}
