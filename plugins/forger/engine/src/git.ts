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
      return execSync(cmd, {cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024}).trim();
    } catch {
      return '';
    }
  };
}

/** A command's whole result, for callers that must tell a failure from empty output. */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type CapturingRunner = (cmd: string) => CommandResult;

export function execCapture(cwd: string): CapturingRunner {
  return (cmd: string): CommandResult => {
    try {
      const stdout = execSync(cmd, {cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
      return {stdout: stdout.trim(), stderr: '', exitCode: 0};
    } catch (e) {
      const err = e as {stdout?: string | Buffer; stderr?: string | Buffer; status?: number | null};
      return {
        stdout: String(err.stdout ?? '').trim(),
        stderr: String(err.stderr ?? '').trim(),
        exitCode: typeof err.status === 'number' ? err.status : 1,
      };
    }
  };
}

/** A plain runner seen as a capturing one: output is stdout, and nothing failed. */
export function capturing(run: CommandRunner): CapturingRunner {
  return cmd => ({stdout: run(cmd), stderr: '', exitCode: 0});
}

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
