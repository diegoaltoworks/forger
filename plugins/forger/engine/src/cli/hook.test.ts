import {afterEach, describe, expect, spyOn, test} from 'bun:test';
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {workerEnv} from '../loop';
import {realHookIo, runHook, type HookIo} from './hook';
import {main} from './main';

const dirs: string[] = [];
const cwd = process.cwd();
afterEach(() => {
  process.chdir(cwd);
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function project(policy?: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-hook-')));
  dirs.push(root);
  mkdirSync(join(root, '.forger'));
  writeFileSync(join(root, '.forger', 'workloop.config.json'), JSON.stringify({tracker: {kind: 'local'}, base_branch: 'main'}));
  if (policy !== undefined) writeFileSync(join(root, '.forger', 'hooks.json'), policy);
  return root;
}

function io(branch: string, engineAlive = false): HookIo {
  return {...realHookIo, git: (_cwd, args) => (args.startsWith('branch') ? `${branch}\n` : null), engineAlive: () => engineAlive};
}

const bash = (root: string, command: string) => ({tool_name: 'Bash', tool_input: {command}, cwd: root});
const now = new Date('2000-01-02T03:04:05.000Z');

describe('the hook for a worker', () => {
  test('a leave-worktree refusal is recorded as worker_denied with the ticket', () => {
    const root = project();
    const tree = join(root, '.forger', 'worktrees', 'issue-7');
    mkdirSync(tree, {recursive: true});
    const appended: Array<{event: string; ticket?: string | null; reason?: string}> = [];
    const spy = {...io('feat/issue-7'), appendEvent: (_r: string, _c: unknown, e: never) => void appended.push(e)};
    const env = workerEnv('issue-7', 3, undefined, undefined, tree);
    const run = runHook({tool_name: 'Bash', tool_input: {command: `cd ${root}`}, cwd: tree}, env, spy, now);
    expect(run.decision).toMatchObject({allow: false, rule: 'leave-worktree'});
    expect(appended).toMatchObject([{event: 'worker_denied', ticket: 'issue-7', reason: `leave-worktree: cd ${root}`}]);
    const inside = runHook({tool_name: 'Write', tool_input: {file_path: join(tree, 'a.ts')}, cwd: tree}, env, spy, now);
    expect(inside.decision).toEqual({allow: true});
  });

  test('a refusal is recorded as worker_denied, and events --json lists it', async () => {
    const root = project();
    const run = runHook(bash(root, 'git status && gh pr merge 7 --squash'), workerEnv('issue-7', 3), io('feat/issue-7'), now);
    expect(run).toMatchObject({role: 'worker', decision: {allow: false, rule: 'merge'}});
    expect(run.recordError).toBeUndefined();

    process.chdir(root);
    const lines: string[] = [];
    const spy = spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
    try {
      await main(['events', '--json']);
    } finally {
      spy.mockRestore();
    }
    expect(JSON.parse(lines.join('\n'))).toEqual([
      {event: 'worker_denied', at: now.toISOString(), iteration: 3, ticket: 'issue-7', reason: 'merge: git status && gh pr merge 7 --squash'},
    ]);
  });

  test('an allowed call records nothing', () => {
    const root = project();
    const appended: unknown[] = [];
    const run = runHook(bash(root, 'git push -u origin feat/issue-7'), workerEnv('issue-7', 1), {...io('feat/issue-7'), appendEvent: (_r, _c, e) => void appended.push(e)});
    expect(run.decision).toEqual({allow: true});
    expect(appended).toEqual([]);
  });

  test('the base branch and the current branch come from the checkout', () => {
    const root = project();
    expect(runHook(bash(root, 'git push'), workerEnv('t', 1), io('main')).decision).toMatchObject({allow: false, rule: 'push-base'});
    expect(runHook(bash(root, 'git push'), workerEnv('t', 1), io('feat/t')).decision).toEqual({allow: true});
  });

  test('the project policy is honoured, and a broken one falls back to the defaults', () => {
    const dropped = project('{"rules": ["push-base"]}');
    expect(runHook(bash(dropped, 'gh pr merge 1'), workerEnv('t', 1), io('feat/t')).decision).toEqual({allow: true});
    const broken = project('{');
    expect(runHook(bash(broken, 'gh pr merge 1'), workerEnv('t', 1), io('feat/t')).decision).toMatchObject({allow: false, rule: 'merge'});
  });

  test('an event that cannot be written still refuses, and says why it was not recorded', () => {
    const root = project();
    const failing: HookIo = {
      ...io('feat/t'),
      appendEvent: () => {
        throw new Error('no state branch');
      },
    };
    expect(runHook(bash(root, 'gh pr merge 1'), workerEnv('t', 1), failing)).toMatchObject({decision: {allow: false}, recordError: 'no state branch'});
  });

  test('an edit of the engine state is refused', () => {
    const root = project();
    const call = {tool_name: 'Write', tool_input: {file_path: join(root, '.forger', 'state.json'), content: '{}'}, cwd: root};
    expect(runHook(call, workerEnv('t', 1), io('feat/t')).decision).toMatchObject({allow: false, rule: 'state-edit'});
  });
});

describe('the hook for the supervisor', () => {
  test('with an engine alive, state-changing git in the loop checkout is refused and read-only git allowed', () => {
    const root = project();
    for (const command of ['git checkout main', 'git reset --hard', 'git stash', 'git pull', 'git merge x', 'git commit -m x']) {
      expect(runHook(bash(root, command), {}, io('main', true))).toMatchObject({role: 'supervisor', decision: {allow: false, rule: 'supervisor-git'}});
    }
    expect(runHook(bash(root, 'git log --oneline'), {}, io('main', true)).decision).toEqual({allow: true});
    expect(runHook(bash(root, 'git checkout main'), {}, io('main', false)).decision).toEqual({allow: true});
  });

  test('outside a forger project nothing is judged', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'forger-hook-none-')));
    dirs.push(dir);
    expect(runHook(bash(dir, 'gh pr merge 1'), workerEnv('t', 1), io('main', true))).toEqual({decision: {allow: true}, role: 'none'});
  });
});

describe('the checks file', () => {
  test('the checks file is among the state paths a worker may not write', async () => {
    const {statePaths} = await import('./hook');
    const {loadConfig} = await import('../config');
    const root = project();
    expect(statePaths(loadConfig(root))).toContain('.forger/checks.jsonl');
  });
});
