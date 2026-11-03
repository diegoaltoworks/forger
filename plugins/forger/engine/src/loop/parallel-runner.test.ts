import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {type BacklogData, backlogFrom} from '../backlog';
import type {AgentResult, AgentRunOptions, CommandResult} from '../ports';
import {mergeConfig} from '../config';
import {AutomationRunner} from './runner';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

const fail: AgentResult = {exitCode: 1, signal: null, output: '', timedOut: false};
const map = {roots: ['src'], folders: ['src/checks', 'src/loop']};
const ticket = (path: string) => ({priority: 'P1', status: 'not_started', body: `## Knock-on\n\`${path}\`\n`});
const data: BacklogData = {
  features: {
    tk_a: ticket('src/checks/a.ts'),
    tk_b: ticket('docs/b.md'),
    tk_c: ticket('src/checks/c.ts'),
  },
};
const only = (...ids: string[]): BacklogData => ({
  features: Object.fromEntries(Object.entries(data.features).filter(([id]) => ids.includes(id))),
});

const ok = (stdout = ''): CommandResult => ({stdout, stderr: '', exitCode: 0});

function setup(parallelism: number, tickets: BacklogData, agent: (o: AgentRunOptions) => Promise<AgentResult>, git: (cmd: string) => string = () => '', capture: (cmd: string) => CommandResult = () => ok()) {
  const root = mkdtempSync(join(tmpdir(), 'forger-parallel-'));
  dirs.push(root);
  mkdirSync(join(root, '.forger'), {recursive: true});
  const config = mergeConfig({parallelism, limits: {pauseBetweenIterations: 0, pauseAfterFailure: 0, killGraceSeconds: 0, maxStallIterations: 99}});
  const captured: string[] = [];
  const calls: AgentRunOptions[] = [];
  let live = 0;
  let peak = 0;
  const runner = new AutomationRunner(root, config, backlogFrom(() => tickets, config), {
    agent: {
      run: async o => {
        calls.push(o);
        peak = Math.max(peak, ++live);
        try {
          return await agent(o);
        } finally {
          live--;
        }
      },
    },
    gitRunner: git,
    gitCapture: cmd => {
      captured.push(cmd);
      return capture(cmd);
    },
    folderMap: map,
    sleep: ms => new Promise(r => setTimeout(r, Math.min(ms, 2))),
  });
  return {runner, root, calls, captured, peak: () => peak};
}

const slow = async (): Promise<AgentResult> => {
  await new Promise(r => setTimeout(r, 20));
  return fail;
};

describe('parallelism 1', () => {
  test('runs one worker at a time in the main checkout, with no worktree', async () => {
    const t = setup(1, data, slow);
    await t.runner.run(2);
    expect(t.peak()).toBe(1);
    expect(t.calls.map(c => c.cwd)).toEqual([t.root, t.root]);
    expect(t.captured).toEqual([]);
  });
});

describe('parallelism 2', () => {
  test('starts two compatible tickets together, each in its own worktree', async () => {
    const t = setup(2, only('tk_a', 'tk_b'), slow);
    await t.runner.run(2);
    expect(t.peak()).toBe(2);
    expect(t.calls.map(c => c.cwd).sort()).toEqual([
      join(t.root, '.forger', 'worktrees', 'tk_a'),
      join(t.root, '.forger', 'worktrees', 'tk_b'),
    ]);
    expect(t.calls[0].prompt).toContain('## Your worktree');
  });

  test('starts one when the next ticket conflicts with the running one', async () => {
    const t = setup(2, only('tk_a', 'tk_c'), slow);
    await t.runner.run(2);
    expect(t.peak()).toBe(1);
    expect(t.calls).toHaveLength(2);
  });

  test('takes the compatible ticket past a conflicting one in the order', async () => {
    const t = setup(2, data, slow);
    await t.runner.run(2);
    expect(t.peak()).toBe(2);
    expect(t.calls.map(c => c.cwd.split('/').pop()).sort()).toEqual(['tk_a', 'tk_b']);
  });

  test('a HALT stops new starts and ends the running workers after the grace', async () => {
    let aborted = 0;
    const t = setup(2, only('tk_a', 'tk_b'), o =>
      new Promise<AgentResult>(resolve => {
        o.abort?.addEventListener('abort', () => {
          aborted++;
          resolve(fail);
        });
      })
    );
    const done = t.runner.run(5);
    while (t.calls.length < 2) await new Promise(r => setTimeout(r, 2));
    writeFileSync(join(t.root, '.forger', 'HALT'), 'Halted: test');
    await done;
    expect(aborted).toBe(2);
    expect(t.calls).toHaveLength(2);
  });

  test('a branch that still conflicts with base ends as conflict and is dropped', async () => {
    let spawned = false;
    const git = (cmd: string): string => {
      const c = cmd.replace(/^git -C '[^']*' /, 'git ');
      if (c === 'git reflog --format=%gs') return spawned ? 'checkout: moving from main to feat/tk_a\nold' : 'old';
      if (c === 'git ls-remote --heads origin feat/tk_a') return 'ccc';
      return '';
    };
    const capture = (cmd: string): CommandResult => {
      if (cmd.includes(' rebase ') && !cmd.includes('--abort')) return {stdout: '', stderr: 'CONFLICT', exitCode: 1};
      if (cmd.includes('diff --name-only')) return ok('src/checks/a.ts\n');
      return ok();
    };
    const t = setup(2, only('tk_a'), async () => {
      spawned = true;
      return fail;
    }, git, capture);
    await t.runner.run(1);
    const state = JSON.parse(readFileSync(join(t.root, '.forger', 'state.json'), 'utf-8'));
    expect(state.last_error).toContain('still conflicts with main');
    expect(state.last_error).toContain('src/checks/a.ts');
    expect(state.consecutive_failures).toBe(1);
    expect(t.captured.some(c => c.includes('rebase --abort'))).toBe(true);
    expect(t.captured).toContain(`git branch -D 'feat/tk_a'`);
    expect(t.captured).toContain(`git push origin --delete 'feat/tk_a'`);
    expect(existsSync(join(t.root, '.forger', 'worktrees'))).toBe(false);
  });
});
