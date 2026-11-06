import {afterEach, describe, expect, spyOn, test} from 'bun:test';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {main} from './main';
import type {CommandRunner} from '../ports';

const dirs: string[] = [];
const startCwd = process.cwd();
afterEach(() => {
  process.chdir(startCwd);
  process.exitCode = 0;
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function project(sandbox: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-detach-')));
  dirs.push(root);
  mkdirSync(join(root, '.forger'));
  writeFileSync(join(root, '.forger', 'backlog.json'), JSON.stringify({features: {a: {status: 'not_started', priority: 'P0'}}}));
  writeFileSync(join(root, '.forger', 'workloop.config.json'), JSON.stringify({tracker: {kind: 'local'}, sandbox, allow_unguarded: true}));
  return root;
}

async function runCli(argv: string[], run: CommandRunner, spawnSession?: (argv: string[], cwd: string) => number): Promise<string> {
  const lines: string[] = [];
  const log = spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
  const err = spyOn(console, 'error').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
  try {
    await main(argv, {run, spawnSession});
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
  return lines.join('\n');
}

function fakeDocker(docker: boolean, calls: string[]): CommandRunner {
  return cmd => {
    calls.push(cmd);
    if (cmd.startsWith('docker info')) {
      if (!docker) throw new Error('Cannot connect to the Docker daemon');
      return '27.0';
    }
    if (cmd.startsWith('git remote get-url origin')) return 'https://github.com/acme/widgets.git';
    if (cmd.startsWith('docker inspect')) throw new Error('No such container');
    if (cmd.startsWith('git rev-list')) return '0';
    return 'main';
  };
}

describe('run --detach', () => {
  test('run --detach starts the engine container with a restart policy and the repository\'s name', async () => {
    const root = project('docker');
    process.chdir(root);
    const calls: string[] = [];
    await runCli(['run', '--continuous', '--detach'], fakeDocker(true, calls));
    const started = calls.find(c => c.startsWith("docker 'run'"));
    expect(started).toBeDefined();
    expect(started).toContain("'--restart' 'unless-stopped'");
    expect(started).toContain("'--name' 'forger-engine-github-com-acme-widgets'");
    expect(started).not.toContain('/home');
    const record = JSON.parse(readFileSync(join(root, '.forger', 'output', 'engine-start.json'), 'utf-8'));
    expect(record.mode).toBe('container');
    const status = await runCli(['status'], fakeDocker(true, []));
    expect(status).toContain('forger-engine-github-com-acme-widgets');
    const orient = JSON.parse(await runCli(['orient', '--json'], fakeDocker(true, [])));
    expect(orient.engine_start.mode).toBe('container');
  });

  test('run --detach without Docker starts the engine in a new session', async () => {
    const root = project('host');
    process.chdir(root);
    const calls: string[] = [];
    const spawned: string[][] = [];
    await runCli(['run', '--continuous', '--detach'], fakeDocker(false, calls), argv => (spawned.push(argv), 4242));
    expect(spawned).toHaveLength(1);
    expect(spawned[0].join(' ')).toContain('run --continuous');
    expect(calls.some(c => c.startsWith("docker 'run'"))).toBe(false);
    const status = JSON.parse(await runCli(['status', '--json'], fakeDocker(false, [])));
    expect(status.engine_start).toEqual({mode: 'session', pid: 4242});
  });

  test('the docker sandbox without a reachable Docker API refuses to detach', async () => {
    process.chdir(project('docker'));
    const out = await runCli(['run', '--continuous', '--detach'], fakeDocker(false, []));
    expect(out).toContain('Not starting');
    expect(process.exitCode).toBe(1);
  });
});
