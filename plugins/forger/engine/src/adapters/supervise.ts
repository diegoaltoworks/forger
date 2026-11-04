/**
 * Runs one worker process under a hard deadline. The worker is spawned as the
 * leader of its own process group so a timeout can end everything it started:
 * SIGTERM to the group, then SIGKILL to the group after a grace period. A
 * grandchild that ignores SIGTERM and holds the output pipes would otherwise
 * keep the run alive indefinitely, so the run resolves on the worker's `exit`,
 * waiting only a short drain for `close`, never on `close` alone.
 *
 * The input is written to a file, synchronously, and the file is the worker's
 * stdin. A pipe is fed by the event loop, and the runner blocks the loop with
 * synchronous git and gh calls while it starts the next worker: long enough
 * for a worker that waits a few seconds for its prompt to give up on it.
 *
 * This is a side-effect boundary; it is tested against real fake workers.
 */

import {spawn} from 'child_process';
import {closeSync, mkdtempSync, openSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {SupervisedResult} from '../ports';

export interface SupervisedOptions {
  command: string;
  args: string[];
  cwd: string;
  /** Added to the inherited environment. */
  env?: Record<string, string>;
  input: string;
  timeoutMs: number;
  /** Time between SIGTERM and SIGKILL to the group once the deadline passes. */
  graceMs: number;
  /** How long to wait for the output pipes to close after the worker exits. */
  drainMs?: number;
  /** Ends the group like a deadline does, without marking the run timed out. */
  abort?: AbortSignal;
  /** Where the input file is written; the system temp directory by default. */
  inputDir?: string;
}

const DEFAULT_DRAIN_MS = 2000;

function signalGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // ESRCH: the group is already empty.
  }
}

export function runSupervised(opts: SupervisedOptions): Promise<SupervisedResult> {
  const {command, args, cwd, input, timeoutMs, graceMs} = opts;
  const drainMs = opts.drainMs ?? DEFAULT_DRAIN_MS;

  let stdin: number;
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(opts.inputDir ?? tmpdir(), 'forger-input-'));
    const file = join(dir, 'input');
    writeFileSync(file, input);
    stdin = openSync(file, 'r');
  } catch (e) {
    if (dir) rmSync(dir, {recursive: true, force: true});
    const inputError = `the prompt could not be written: ${(e as Error).message}`;
    return Promise.resolve({exitCode: 1, signal: null, output: `Error: ${inputError}\n`, timedOut: false, inputError});
  }
  const inputDir = dir;

  return new Promise(resolve => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {cwd, env: opts.env ? {...process.env, ...opts.env} : process.env, stdio: [stdin, 'pipe', 'pipe'], detached: true});
    } finally {
      // The worker holds its own descriptor to the file now.
      closeSync(stdin);
      rmSync(inputDir, {recursive: true, force: true});
    }
    const pid = child.pid;

    let output = '';
    let timedOut = false;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: SupervisedResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(killTimer);
      opts.abort?.removeEventListener('abort', onAbort);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(result);
    };

    const deadline = setTimeout(() => {
      timedOut = true;
      signalGroup(pid, 'SIGTERM');
      killTimer = setTimeout(() => signalGroup(pid, 'SIGKILL'), graceMs);
    }, timeoutMs);

    const onAbort = (): void => {
      signalGroup(pid, 'SIGTERM');
      killTimer ??= setTimeout(() => signalGroup(pid, 'SIGKILL'), graceMs);
    };
    if (opts.abort?.aborted) onAbort();
    else opts.abort?.addEventListener('abort', onAbort, {once: true});

    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });
    child.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    child.on('exit', (code, signal) => {
      clearTimeout(deadline);
      clearTimeout(killTimer);
      // The leader is gone; anything left in its group after a timeout is a
      // straggler that already ignored SIGTERM.
      if (timedOut) signalGroup(pid, 'SIGKILL');
      const result = (): SupervisedResult => ({
        exitCode: code ?? 1,
        signal: signal ?? null,
        output,
        timedOut,
        inputError: null,
      });
      const drain = setTimeout(() => finish(result()), drainMs);
      child.on('close', () => {
        clearTimeout(drain);
        finish(result());
      });
    });

    child.on('error', err => {
      finish({exitCode: 1, signal: null, output: `Error: ${err.message}\n${output}`, timedOut, inputError: `not started: ${err.message}`});
    });
  });
}
