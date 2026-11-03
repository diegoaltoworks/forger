/**
 * The real `AppServer`: runs the project's serve command as the leader of its
 * own process group, so stopping it ends the dev server's children too, and
 * polls the url until it answers. An app that exits before it answers is
 * reported with its output, not waited on.
 */

import {spawn, type ChildProcess} from 'child_process';

import {UiInfrastructureError, type AppServer} from '../ports';

const POLL_MS = 200;
const GRACE_MS = 3000;

export function shellAppServer(cwd: string): AppServer {
  let child: ChildProcess | undefined;
  let output = '';
  let exited: number | null | undefined;

  const signal = (proc: ChildProcess, sig: NodeJS.Signals): void => {
    if (!proc.pid) return;
    try {
      process.kill(-proc.pid, sig);
    } catch {
      // ESRCH: the group is already gone.
    }
  };

  return {
    async start(command) {
      output = '';
      exited = undefined;
      child = spawn('sh', ['-c', command], {cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true});
      child.stdout?.on('data', (d: Buffer) => (output += d.toString()));
      child.stderr?.on('data', (d: Buffer) => (output += d.toString()));
      child.on('exit', code => (exited = code ?? 1));
      child.on('error', err => {
        output += `Error: ${err.message}\n`;
        exited = 1;
      });
    },

    async waitReady(url, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (exited !== undefined) {
          throw new UiInfrastructureError('app-not-ready', `the app exited (code ${exited}) before ${url} answered:\n${output.trim()}`);
        }
        try {
          await fetch(url, {signal: AbortSignal.timeout(2000)});
          return;
        } catch {
          await new Promise(r => setTimeout(r, POLL_MS));
        }
      }
      throw new UiInfrastructureError('app-not-ready', `${url} did not answer within ${Math.round(timeoutMs / 1000)}s:\n${output.trim()}`);
    },

    async stop() {
      const proc = child;
      if (!proc) return;
      child = undefined;
      if (exited === undefined) {
        const gone = new Promise<void>(resolve => proc.once('exit', () => resolve()));
        signal(proc, 'SIGTERM');
        const killer = setTimeout(() => signal(proc, 'SIGKILL'), GRACE_MS);
        await gone;
        clearTimeout(killer);
      }
      signal(proc, 'SIGKILL');
    },
  };
}
