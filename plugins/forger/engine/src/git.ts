/**
 * The reality check on an iteration's completion claim. A completion signal is
 * the agent's own account; this verifies the repo actually landed on the base
 * branch, clean, and pushed. The git calls go through an injectable
 * CommandRunner so the branching logic is unit-testable with canned output -
 * squash merges rewrite the SHA, so where HEAD sits and whether base matches
 * its remote is the only reliable test.
 */

import {execSync} from 'child_process';

export type CommandRunner = (cmd: string) => string;

/** A CommandRunner backed by real git in the given working directory. */
export function execRunner(cwd: string): CommandRunner {
  return (cmd: string): string => {
    try {
      // The GitHub backlog query returns every intake issue ever closed too;
      // the default 1MB buffer would fail it once the history grows.
      return execSync(cmd, {cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024}).trim();
    } catch {
      return '';
    }
  };
}

/**
 * Return a human-readable reason the working state is NOT a clean merged base,
 * or null if it is. Order matters: wrong branch, then dirty tree, then unpushed.
 */
export function verifyMerged(run: CommandRunner, baseBranch: string): string | null {
  const branch = run('git branch --show-current');
  if (branch !== baseBranch) {
    return `HEAD is on "${branch || 'detached'}", not ${baseBranch}`;
  }

  if (run('git status --porcelain') !== '') return 'working tree is dirty';

  run(`git fetch --quiet origin ${baseBranch}`);
  const ahead = run(`git rev-list --count origin/${baseBranch}..${baseBranch}`);
  if (ahead !== '' && ahead !== '0') return `${baseBranch} is ${ahead} commit(s) unpushed`;

  return null;
}
