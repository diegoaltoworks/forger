import {afterEach, describe, expect, test} from 'bun:test';
import {mkdtempSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {CommandResult, Sandbox, SandboxStart} from '../ports';
import {claudeHarness} from './claude';
import {agentFor} from './harnesses';
import {hostSandbox} from './host-sandbox';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

const ok = (stdout = ''): CommandResult => ({stdout, stderr: '', exitCode: 0});

describe('the host sandbox', () => {
  test('the host sandbox runs a worker in a worktree as the runner did before', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'forger-host-'));
    dirs.push(stateDir);
    const git: string[] = [];
    const box = hostSandbox(cmd => {
      git.push(cmd);
      return cmd.includes('rev-parse') ? {stdout: '', stderr: '', exitCode: 1} : ok();
    });
    const workspace = box.prepare({ticket: 'issue-7', baseBranch: 'main', stateDir});
    expect(workspace).toEqual({ok: true, ticket: 'issue-7', path: join(stateDir, 'worktrees', 'issue-7')});
    expect(git.some(c => c.startsWith('git worktree add -b') && c.includes('feat/issue-7') && c.includes('origin/main'))).toBe(true);

    const cwd = tmpdir();
    const done = await box.start({command: 'sh', args: ['-c', 'pwd; echo "$FORGER_X"; cat'], cwd, env: {FORGER_X: 'seen'}, input: 'prompt', timeoutMs: 5000, graceMs: 100}).result;
    expect(done.exitCode).toBe(0);
    expect(done.output).toContain('seen');
    expect(done.output).toContain('prompt');

    const timed = await box.start({command: 'sleep', args: ['30'], cwd, input: '', timeoutMs: 100, graceMs: 100}).result;
    expect(timed.timedOut).toBe(true);

    const running = box.start({command: 'sleep', args: ['30'], cwd, input: '', timeoutMs: 30000, graceMs: 100});
    running.end();
    expect((await running.result).timedOut).toBe(false);

    expect(box.cleanup({ticket: 'issue-7', baseBranch: 'main', stateDir}, false)).toBeNull();
    expect(git.some(c => c.startsWith('git worktree remove --force'))).toBe(true);
  });

  test('a failed worktree is reported, not thrown', () => {
    const box = hostSandbox(() => ({stdout: '', stderr: 'fatal: no remote', exitCode: 1}));
    const w = box.prepare({ticket: 'issue-7', baseBranch: 'main', stateDir: '/nowhere'});
    expect(w.ok).toBe(false);
  });
});

describe('the agent', () => {
  test('the runner starts a worker only through the sandbox seam', async () => {
    const started: SandboxStart[] = [];
    const fake: Sandbox = {
      id: 'fake',
      prepare: r => ({ok: true, ticket: r.ticket, path: '/fake'}),
      cleanup: () => null,
      start: spec => {
        started.push(spec);
        return {result: Promise.resolve({exitCode: 0, signal: null, output: 'done', timedOut: false}), end: () => {}};
      },
    };
    const result = await agentFor(claudeHarness, {}, fake).run({
      prompt: 'p', sessionId: 's', tier: {model: 'standard', budget: 5}, model: 'sonnet', workerCommand: 'forger:auto-ticket',
      cwd: '/fake', timeoutMinutes: 1, killGraceSeconds: 2,
    });
    expect(result.output).toBe('done');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({command: 'claude', cwd: '/fake', timeoutMs: 60000, graceMs: 2000, input: 'p'});
  });
});
