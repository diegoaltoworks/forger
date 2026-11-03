/**
 * The real command runners: a shell command in a working directory, through
 * execSync. One swallows failures to empty output; the other keeps stdout,
 * stderr and the exit code so a caller can tell a failure from an empty answer.
 */

import {execSync} from 'child_process';

import type {CapturingRunner, CommandResult, CommandRunner} from '../ports';

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

export function execCapture(cwd: string, env?: Record<string, string>): CapturingRunner {
  return (cmd: string): CommandResult => {
    try {
      const stdout = execSync(cmd, {
        cwd,
        env: env ? {...process.env, ...env} : process.env,
        encoding: 'utf-8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
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
