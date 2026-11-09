import {afterEach, describe, expect, test} from 'bun:test';
import {mkdtempSync, realpathSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {AgentRunner, CommandRunner} from '../ports';
import {verifyPr, type VerifyOptions} from './verify';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

const ok = (name: string) => ({__typename: 'CheckRun', name, status: 'COMPLETED', conclusion: 'SUCCESS'});
const bad = (name: string) => ({__typename: 'CheckRun', name, status: 'COMPLETED', conclusion: 'FAILURE'});
const verifyStatus = {__typename: 'StatusContext', context: 'forger/verify', state: 'FAILURE'};

function setup(criterion: string, rollups: unknown[], gatesFails = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-gates-green-')));
  dirs.push(root);
  const prompts: string[] = [];
  const calls: string[] = [];
  let views = 0;
  const run: CommandRunner = cmd => {
    calls.push(cmd);
    if (cmd.startsWith('gh pr view') && cmd.includes('headRefOid')) {
      return JSON.stringify({number: 5, state: 'OPEN', headRefOid: 'abc', headRefName: 'feat/issue-9', body: '', baseRefName: 'main', statusCheckRollup: rollups[0]});
    }
    if (cmd.startsWith('gh pr view')) return JSON.stringify({statusCheckRollup: rollups[Math.min(++views, rollups.length - 1)]});
    if (cmd.startsWith('gh issue view')) return `## Acceptance\n- [ ] ${criterion}\n- [ ] other thing\n`;
    if (cmd.startsWith('gh pr diff')) return '+diff';
    if (cmd.includes('run-the-gates') && gatesFails) throw new Error('exit 1');
    return '';
  };
  const agent: AgentRunner = {
    async run(o) {
      prompts.push(o.prompt);
      return {exitCode: 0, signal: null, output: JSON.stringify({verdict: [{criterion: 'c2', verdict: 'cannot_tell', missing: 'no_test', evidence: []}]}), timedOut: false};
    },
  };
  const opts: VerifyOptions = {
    pr: 5,
    trackerKind: 'github',
    backlogFile: '',
    verdictsDir: join(root, 'v'),
    tmpDir: join(root, 't'),
    tier: {model: 'deep', budget: 1},
    setup: null,
    model: 'opus',
    verifierCommand: 'forger:verify',
    timeoutMinutes: 1,
    killGraceSeconds: 1,
    sessionId: 's',
    pollMs: 1,
    sleep: async () => {},
    now: () => new Date('2026-01-01T00:00:00Z'),
  };
  return {run, agent, opts, prompts, calls};
}

describe('Gates green is decided by the engine', () => {
  test('Gates green with every CI check successful is met with ci evidence and is not sent to the model', async () => {
    const f = setup('Gates green', [[ok('build'), ok('test')]]);
    const r = await verifyPr(f.run, f.agent, f.opts);
    const e = r.entries.find(x => x.criterion === 'c1')!;
    expect(e.verdict).toBe('met');
    expect(e.evidence).toEqual([{kind: 'ci', ref: 'build: passed'}, {kind: 'ci', ref: 'test: passed'}]);
    expect(f.prompts[0]).not.toContain('- c1:');
    expect(f.prompts[0]).toContain('Decided by the engine');
  });

  test('Gates green with a failing check is not_met naming the check', async () => {
    const f = setup('Gates green', [[ok('build'), bad('test')]]);
    const r = await verifyPr(f.run, f.agent, f.opts);
    const e = r.entries.find(x => x.criterion === 'c1')!;
    expect(e.verdict).toBe('not_met');
    expect(e.evidence[0].ref).toContain('test');
  });

  test('Gates green ignores the forger/verify status', async () => {
    const f = setup('Gates green', [[ok('build'), verifyStatus]]);
    const r = await verifyPr(f.run, f.agent, f.opts);
    expect(r.entries.find(x => x.criterion === 'c1')!.verdict).toBe('met');
  });

  test('Gates green including a named job requires that job among the successes', async () => {
    const without = setup('Gates green, including the e2e job', [[ok('build')]]);
    const a = await verifyPr(without.run, without.agent, without.opts);
    const missing = a.entries.find(x => x.criterion === 'c1')!;
    expect(missing.verdict).toBe('not_met');
    expect(missing.evidence[0].ref).toContain('e2e');
    const withJob = setup('Gates green, including the e2e job', [[ok('build'), ok('e2e')]]);
    const b = await verifyPr(withJob.run, withJob.agent, withJob.opts);
    expect(b.entries.find(x => x.criterion === 'c1')!.verdict).toBe('met');
  });

  test('Gates green with no CI runs the gates command and decides from its exit code', async () => {
    const pass = setup('Gates green', [[]]);
    const a = await verifyPr(pass.run, pass.agent, {...pass.opts, gates: 'run-the-gates'});
    expect(a.entries.find(x => x.criterion === 'c1')!.verdict).toBe('met');
    expect(pass.calls.some(c => c.includes('run-the-gates'))).toBe(true);
    const fail = setup('Gates green', [[]], true);
    const b = await verifyPr(fail.run, fail.agent, {...fail.opts, gates: 'run-the-gates'});
    expect(b.entries.find(x => x.criterion === 'c1')!.verdict).toBe('not_met');
  });

  test('Gates green waits for pending checks, then decides from the finished ones', async () => {
    const pending = {__typename: 'CheckRun', name: 'build', status: 'IN_PROGRESS', conclusion: null};
    const f = setup('Gates green', [[pending], [pending], [ok('build')]]);
    const r = await verifyPr(f.run, f.agent, {...f.opts, checksTimeoutMs: 100});
    expect(r.entries.find(x => x.criterion === 'c1')!.verdict).toBe('met');
  });

  test('Gates green still pending after the wait is cannot_tell with missing pending', async () => {
    const pending = {__typename: 'CheckRun', name: 'build', status: 'IN_PROGRESS', conclusion: null};
    const f = setup('Gates green', [[pending]]);
    const r = await verifyPr(f.run, f.agent, {...f.opts, checksTimeoutMs: 3});
    const e = r.entries.find(x => x.criterion === 'c1')!;
    expect(e.verdict).toBe('cannot_tell');
    expect(e.missing).toBe('pending');
  });
});
