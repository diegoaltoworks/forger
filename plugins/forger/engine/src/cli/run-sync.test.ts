import {afterEach, describe, expect, spyOn, test} from 'bun:test';
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {main} from './main';
import type {CapturingRunner} from '../ports';

const dirs: string[] = [];
const startCwd = process.cwd();
afterEach(() => {
  process.chdir(startCwd);
  process.exitCode = 0;
  delete process.env.FORGER_RESTARTED;
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function project(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-sync-')));
  dirs.push(root);
  mkdirSync(join(root, '.forger'));
  writeFileSync(join(root, '.forger', 'backlog.json'), JSON.stringify({features: {a: {status: 'not_started', priority: 'P0'}}}));
  writeFileSync(join(root, '.forger', 'workloop.config.json'), JSON.stringify({tracker: {kind: 'local'}, allow_unguarded: true}));
  return root;
}

interface Git {
  behind?: string;
  status?: string;
  branch?: string;
  mergeFails?: boolean;
  changed?: string;
}

function fakeGit(git: Git, calls: string[]) {
  return (cmd: string): string => {
    calls.push(cmd);
    if (cmd.startsWith('git rev-list')) return git.behind ?? '0';
    if (cmd.startsWith('git status')) return git.status ?? '';
    if (cmd.startsWith('git branch')) return git.branch ?? 'main';
    if (cmd.startsWith('git merge')) {
      if (git.mergeFails) throw Object.assign(new Error('fatal: Not possible to fast-forward, aborting.'), {stderr: 'fatal: Not possible to fast-forward, aborting.'});
      return '';
    }
    if (cmd.startsWith('git diff --name-only')) return git.changed ?? '';
    if (cmd.startsWith('git rev-parse HEAD')) return 'abc';
    if (cmd.startsWith('git remote get-url')) return 'https://github.com/acme/w.git';
    return '';
  };
}

async function runCli(root: string, git: Git, extra: {restart?: () => number; pluginRoot?: string} = {}, argv = ['run', '--continuous', '--detach']) {
  process.chdir(root);
  const calls: string[] = [];
  const lines: string[] = [];
  const log = spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
  const err = spyOn(console, 'error').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
  let spawned = 0;
  try {
    await main(argv, {run: fakeGit(git, calls), spawnSession: () => ++spawned, ...extra});
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
  return {calls, out: lines.join('\n'), spawned};
}

const merges = (calls: string[]): string[] => calls.filter(c => c.startsWith('git merge'));

describe('run brings the base branch up to date', () => {
  test('run fast-forwards a base branch that is behind its remote, with no uncommitted changes, before the first pick', async () => {
    const r = await runCli(project(), {behind: '2'});
    expect(merges(r.calls)).toEqual(['git merge --ff-only origin/main']);
    expect(r.spawned).toBe(1);
  });

  test("run fast-forwards a tree whose only changes are the engine's runtime files", async () => {
    const r = await runCli(project(), {behind: '2', status: ' M .forger/state.json\n M .forger/events.jsonl\n'});
    expect(merges(r.calls)).toHaveLength(1);
    expect(r.spawned).toBe(1);
  });

  test('run refuses to start and prints the reason when the fast-forward fails', async () => {
    const r = await runCli(project(), {behind: '2', mergeFails: true});
    expect(r.out).toContain('Not starting');
    expect(r.out).toContain('Not possible to fast-forward');
    expect(r.spawned).toBe(0);
    expect(process.exitCode).toBe(1);
    expect(r.calls.some(c => /stash|reset|checkout|clean/.test(c))).toBe(false);
  });

  test('run leaves a checkout with other uncommitted changes as it is', async () => {
    const r = await runCli(project(), {behind: '2', status: ' M src/a.ts\n'});
    expect(merges(r.calls)).toEqual([]);
    expect(r.spawned).toBe(1);
  });

  test('run does not touch the checkout while another engine holds the lock', async () => {
    const root = project();
    writeFileSync(join(root, '.forger', 'runner.lock'), String(process.pid));
    const r = await runCli(root, {behind: '2'});
    expect(merges(r.calls)).toEqual([]);
  });

  test('run leaves a checkout that is not on the base branch as it is', async () => {
    const r = await runCli(project(), {behind: '2', branch: 'feat/x'});
    expect(merges(r.calls)).toEqual([]);
  });

  test('the engine starts itself again once when the fast-forward changed the plugin it runs from', async () => {
    const root = project();
    let restarts = 0;
    const r = await runCli(root, {behind: '1', changed: 'plugins/forger/bin/work.ts\n'}, {pluginRoot: join(root, 'plugins', 'forger'), restart: () => ++restarts && 0}, ['run']);
    expect(restarts).toBe(1);
    expect(r.out).toContain('starting again');
  });

  test('the engine does not start itself again for a change outside the plugin, or when it already did', async () => {
    const root = project();
    let restarts = 0;
    const extra = {pluginRoot: join(root, 'plugins', 'forger'), restart: () => ++restarts && 0};
    await runCli(root, {behind: '1', changed: 'docs/a.md\n'}, extra);
    process.env.FORGER_RESTARTED = '1';
    await runCli(root, {behind: '1', changed: 'plugins/forger/bin/work.ts\n'}, extra);
    expect(restarts).toBe(0);
  });
});
