import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {runSupervised} from './supervise';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'forger-supervise-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitDead(pid: number, ms = 2000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!alive(pid)) return true;
    await Bun.sleep(20);
  }
  return !alive(pid);
}

async function readPid(file: string, ms = 2000): Promise<number> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const n = Number(readFileSync(file, 'utf-8').trim());
      if (n > 0) return n;
    } catch {
      // not written yet
    }
    await Bun.sleep(20);
  }
  throw new Error(`no pid in ${file}`);
}

describe('runSupervised', () => {
  test('returns output and exit code of a worker that finishes', async () => {
    const r = await runSupervised({
      command: 'bash',
      args: ['-c', 'cat; echo done; exit 3'],
      cwd: tmp(),
      input: 'hello\n',
      timeoutMs: 5000,
      graceMs: 500,
    });
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(3);
    expect(r.signal).toBeNull();
    expect(r.output).toBe('hello\ndone\n');
  });

  test('adds the given variables to the inherited environment', async () => {
    const r = await runSupervised({command: 'bash', args: ['-c', 'echo "$FORGER_ROLE:${PATH:+path}"'], cwd: tmp(), env: {FORGER_ROLE: 'worker'}, input: '', timeoutMs: 5000, graceMs: 500});
    expect(r.output.trim()).toBe('worker:path');
  });

  test('ends a worker that ignores SIGTERM and its grandchild, and resolves', async () => {
    const dir = tmp();
    const pidFile = join(dir, 'grandchild.pid');
    // The grandchild holds the output pipes, so a run that waited on `close`
    // would never resolve while it lived.
    const script = [
      "trap '' TERM",
      `bash -c "trap '' TERM; while true; do sleep 0.05; done" &`,
      `echo $! > ${pidFile}`,
      'echo started',
      'while true; do sleep 0.05; done',
    ].join('\n');

    const started = Date.now();
    const run = runSupervised({
      command: 'bash',
      args: ['-c', script],
      cwd: dir,
      input: '',
      timeoutMs: 300,
      graceMs: 300,
    });
    const grandchild = await readPid(pidFile);
    const r = await run;

    expect(r.timedOut).toBe(true);
    expect(r.signal).toBe('SIGKILL');
    expect(r.output).toContain('started');
    expect(Date.now() - started).toBeLessThan(5000);
    expect(await waitDead(grandchild)).toBe(true);
  });

  test('a worker that exits on SIGTERM takes no SIGKILL', async () => {
    const r = await runSupervised({
      command: 'bash',
      args: ['-c', 'sleep 30 & wait'],
      cwd: tmp(),
      input: '',
      timeoutMs: 200,
      graceMs: 5000,
    });
    expect(r.timedOut).toBe(true);
    expect(r.signal).toBe('SIGTERM');
  });

  test('resolves when the worker exits even if a leftover child holds the pipes', async () => {
    const dir = tmp();
    const pidFile = join(dir, 'leftover.pid');
    const started = Date.now();
    const r = await runSupervised({
      command: 'bash',
      args: ['-c', `sleep 30 & echo $! > ${pidFile}; echo bye; exit 0`],
      cwd: dir,
      input: '',
      timeoutMs: 10000,
      graceMs: 500,
      drainMs: 200,
    });
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain('bye');
    expect(Date.now() - started).toBeLessThan(5000);
    process.kill(await readPid(pidFile), 'SIGKILL');
  });

  test('reports a command that cannot start', async () => {
    const r = await runSupervised({
      command: 'forger-no-such-command',
      args: [],
      cwd: tmp(),
      input: '',
      timeoutMs: 1000,
      graceMs: 100,
    });
    expect(r.exitCode).toBe(1);
    expect(r.timedOut).toBe(false);
    expect(r.output).toContain('Error:');
  });
});

describe('runSupervised input delivery', () => {
  // A worker that, like the claude CLI, gives up when its stdin stays empty.
  const impatient = ['-c', 'timeout 1 head -c 8 || echo NO-PROMPT'];

  test('two workers started in the same tick both receive their prompt while the event loop is blocked', async () => {
    const cwd = tmp();
    const runs = ['prompt-a', 'prompt-b'].map(input => runSupervised({command: 'bash', args: impatient, cwd, input, timeoutMs: 5000, graceMs: 200}));
    // What the runner does next: synchronous git and gh calls for the next worker.
    Bun.sleepSync(1500);
    const [a, b] = await Promise.all(runs);
    expect(a).toMatchObject({output: 'prompt-a', inputError: null});
    expect(b).toMatchObject({output: 'prompt-b', inputError: null});
  });

  test('a prompt that cannot be written starts no worker and says why', async () => {
    const cwd = tmp();
    const marker = join(cwd, 'ran');
    const r = await runSupervised({
      command: 'bash',
      args: ['-c', `touch '${marker}'`],
      cwd,
      input: 'prompt',
      timeoutMs: 5000,
      graceMs: 200,
      inputDir: join(cwd, 'missing'),
    });
    expect(r.exitCode).toBe(1);
    expect(r.inputError).toContain('the prompt could not be written');
    expect(existsSync(marker)).toBe(false);
  });

  test('leaves no input file behind', async () => {
    const inputDir = tmp();
    await runSupervised({command: 'bash', args: ['-c', 'cat >/dev/null'], cwd: tmp(), input: 'prompt', timeoutMs: 5000, graceMs: 200, inputDir});
    expect(readdirSync(inputDir)).toEqual([]);
  });
});
