import {afterEach, describe, expect, spyOn, test} from 'bun:test';
import {execSync} from 'child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {workerEnv} from '../loop';
import type {CommandRunner} from '../ports';
import {main} from './main';

const dirs: string[] = [];
const cwd = process.cwd();
afterEach(() => {
  process.chdir(cwd);
  process.exitCode = 0;
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

const sh = (cmd: string): string => execSync(cmd, {encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe']});

function setup(wait = 0): {root: string; engine: string} {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-guard-')));
  dirs.push(root);
  mkdirSync(join(root, '.forger'));
  writeFileSync(join(root, '.forger', 'workloop.config.json'), JSON.stringify({tracker: {kind: 'local'}, base_branch: 'main', limits: {engineChangedWaitSeconds: wait}}));
  const engine = join(root, 'engine');
  mkdirSync(engine);
  writeFileSync(join(engine, 'a.ts'), 'a\n');
  sh(`git -C ${root} init -q`);
  sh(`git -C ${root} add engine && git -C ${root} -c user.name=t -c user.email=t@t commit -q -m init`);
  process.chdir(root);
  return {root, engine};
}

async function call(argv: string[], engine: string, sleep?: (ms: number) => Promise<void>): Promise<{calls: string[]; out: string}> {
  const calls: string[] = [];
  const run: CommandRunner = cmd => {
    if (cmd.startsWith('git -C ')) return sh(cmd);
    calls.push(cmd);
    return '';
  };
  const lines: string[] = [];
  const log = spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
  const err = spyOn(console, 'error').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
  try {
    await main(argv, {run, pluginRoot: engine, ...(sleep ? {sleep} : {})});
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
  return {calls, out: lines.join('\n')};
}

const events = (root: string) => readFileSync(join(root, '.forger', 'events.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));

describe('verify and merge from a changed engine', () => {
  test('verify refuses and records no verdict when the engine\'s source has uncommitted changes', async () => {
    const {root, engine} = setup();
    writeFileSync(join(engine, 'a.ts'), 'draft\n');
    const {calls, out} = await call(['verify', '--pr', '9', '--json'], engine);
    expect(process.exitCode).toBe(1);
    expect(out).toContain('engine/a.ts');
    expect(calls).toEqual([]);
    expect(existsSync(join(root, '.forger', 'verdicts'))).toBe(false);
  });

  test('merge refuses when the engine\'s source has uncommitted changes', async () => {
    const {engine} = setup();
    writeFileSync(join(engine, 'new.ts'), 'draft\n');
    const {calls, out} = await call(['merge', '--pr', '9'], engine);
    expect(process.exitCode).toBe(1);
    expect(out).toContain('engine/new.ts');
    expect(calls.filter(c => c.startsWith('gh pr'))).toEqual([]);
  });

  test('the refusal is recorded as an engine_changed event that names the paths', async () => {
    const {root, engine} = setup();
    writeFileSync(join(engine, 'a.ts'), 'draft\n');
    const saved = {...process.env};
    Object.assign(process.env, workerEnv('issue-7', 3));
    try {
      await call(['merge', '--pr', '9'], engine);
    } finally {
      process.env = saved;
    }
    expect(events(root)).toMatchObject([{event: 'engine_changed', ticket: 'issue-7', iteration: 3, reason: 'merge: engine/a.ts'}]);
  });

  test('a clean engine goes on to the command', async () => {
    const {engine} = setup();
    const {calls} = await call(['merge', '--pr', '9'], engine);
    expect(calls.some(c => c.startsWith('gh pr'))).toBe(true);
  });

  const gone = (engine: string) => async () => void writeFileSync(join(engine, 'a.ts'), 'a\n');

  test('verify goes on when the engine\'s changes are gone within the wait', async () => {
    const {engine} = setup(60);
    writeFileSync(join(engine, 'a.ts'), 'draft\n');
    const {out} = await call(['verify', '--pr', '9', '--json'], engine, gone(engine));
    expect(out).not.toContain('engine_changed');
    expect(out).not.toContain('uncommitted changes');
  });

  test('merge goes on when the engine\'s changes are gone within the wait', async () => {
    const {engine} = setup(60);
    writeFileSync(join(engine, 'a.ts'), 'draft\n');
    const {calls} = await call(['merge', '--pr', '9'], engine, gone(engine));
    expect(calls.some(c => c.startsWith('gh pr'))).toBe(true);
  });

  test('no engine_changed event is recorded when the changes are gone within the wait', async () => {
    const {root, engine} = setup(60);
    writeFileSync(join(engine, 'a.ts'), 'draft\n');
    await call(['merge', '--pr', '9'], engine, gone(engine));
    expect(existsSync(join(root, '.forger', 'events.jsonl')) ? events(root).filter(e => e.event === 'engine_changed') : []).toEqual([]);
  });

  test('verify refuses and records engine_changed when the changes outlast the wait', async () => {
    const {root, engine} = setup(10);
    writeFileSync(join(engine, 'a.ts'), 'draft\n');
    const pauses: number[] = [];
    const {calls, out} = await call(['verify', '--pr', '9', '--json'], engine, async ms => void pauses.push(ms));
    expect(process.exitCode).toBe(1);
    expect(pauses.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(out).toContain('engine/a.ts');
    expect(calls).toEqual([]);
    expect(events(root)).toMatchObject([{event: 'engine_changed', reason: 'verify: engine/a.ts'}]);
  });
});
