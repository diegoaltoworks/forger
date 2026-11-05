import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {workerEnv} from '../loop';
import {realHookIo, runHook, type HookIo} from './hook';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function project(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-hook-')));
  dirs.push(root);
  mkdirSync(join(root, '.forger'));
  writeFileSync(join(root, '.forger', 'workloop.config.json'), JSON.stringify({tracker: {kind: 'local'}, base_branch: 'main'}));
  return root;
}

const io: HookIo = {...realHookIo, git: (_cwd, args) => (args.startsWith('branch') ? 'feat/issue-7\n' : null), appendEvent: () => {}};
const env = workerEnv('issue-7', 1);

describe('payloads from other harnesses', () => {
  test('a Copilot call and a Codex apply_patch are judged like the rest', () => {
    const root = project();
    const copilot = {toolName: 'bash', toolArgs: JSON.stringify({command: 'gh pr merge 7'}), cwd: root};
    expect(runHook(copilot, env, io).decision).toMatchObject({allow: false, rule: 'merge'});
    const patch = {tool_name: 'apply_patch', tool_input: {command: '*** Begin Patch\n*** Update File: .forger/state.json\n*** End Patch'}, cwd: root};
    expect(runHook(patch, env, io).decision).toMatchObject({allow: false, rule: 'state-edit'});
    const fine = {tool_name: 'apply_patch', tool_input: {command: '*** Update File: src/a.ts'}, cwd: root};
    expect(runHook(fine, env, io).decision.allow).toBe(true);
  });
});
