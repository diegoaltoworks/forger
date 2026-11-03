import {afterEach, describe, expect, test} from 'bun:test';
import {mkdtempSync, readFileSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {PRD} from './backlog';
import type {ClaudeResult, RunClaudeOptions} from './claude';
import {mergeConfig} from './config';
import {AutomationRunner} from './runner';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

const backlog: PRD = {
  features: {
    the_ticket: {priority: 'P1', status: 'not_started', depends_on: []},
  },
};

function runnerWith(result: ClaudeResult): {
  runner: AutomationRunner;
  root: string;
  calls: RunClaudeOptions[];
} {
  const root = mkdtempSync(join(tmpdir(), 'forger-runner-'));
  dirs.push(root);
  const calls: RunClaudeOptions[] = [];
  const config = mergeConfig({limits: {timeoutMinutes: 7, killGraceSeconds: 11}});
  const runner = new AutomationRunner(root, config, {
    runClaude: async opts => {
      calls.push(opts);
      return result;
    },
    gitRunner: (cmd: string) => (cmd === 'git branch --show-current' ? 'main' : ''),
    loadPRD: () => backlog,
    uuid: () => '00000000-0000-0000-0000-000000000000',
  });
  return {runner, root, calls};
}

function iterationLog(root: string, n: number): string {
  return readFileSync(join(root, '.claude', 'output', `iteration-${n}.log`), 'utf-8');
}

describe('AutomationRunner iteration log', () => {
  test('passes the timeout and kill grace from config to the worker spawn', async () => {
    const {runner, calls} = runnerWith({
      exitCode: 0,
      signal: null,
      output: '<process>complete</process>',
      timedOut: false,
    });
    await runner.runIteration(1);
    expect(calls[0].timeoutMinutes).toBe(7);
    expect(calls[0].killGraceSeconds).toBe(11);
  });

  test('is written on success', async () => {
    const {runner, root} = runnerWith({
      exitCode: 0,
      signal: null,
      output: 'done <process>complete</process>\n',
      timedOut: false,
    });
    expect(await runner.runIteration(1)).toBe(true);
    const log = iterationLog(root, 1);
    expect(log).toContain('ticket: the_ticket');
    expect(log).toContain('outcome: exited with code 0');
    expect(log).toContain('done <process>complete</process>');
  });

  test('is written on failure', async () => {
    const {runner, root} = runnerWith({exitCode: 2, signal: null, output: '', timedOut: false});
    expect(await runner.runIteration(2)).toBe(false);
    const log = iterationLog(root, 2);
    expect(log).toContain('outcome: exited with code 2');
    expect(log).toContain('(no output captured)');
  });

  test('is written on timeout, naming the ticket, elapsed time and signal', async () => {
    const {runner, root} = runnerWith({
      exitCode: 1,
      signal: 'SIGKILL',
      output: 'partial work\n',
      timedOut: true,
    });
    expect(await runner.runIteration(3)).toBe(false);
    const log = iterationLog(root, 3);
    expect(log).toContain('ticket: the_ticket');
    expect(log).toMatch(/elapsed: \d+s/);
    expect(log).toContain('outcome: timed out after 7 minutes, ended by SIGKILL');
    expect(log).toContain('partial work');
    const state = JSON.parse(readFileSync(join(root, '.claude', 'state.json'), 'utf-8'));
    expect(state.status).toBe('timeout');
    expect(state.last_error).toBe('Timeout after 7 minutes, ended by SIGKILL');
  });
});
