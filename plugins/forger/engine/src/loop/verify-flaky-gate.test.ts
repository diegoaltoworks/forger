import {afterEach, describe, expect, test} from 'bun:test';
import {mkdtempSync, realpathSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {AgentRunner, CommandRunner} from '../ports';
import {failedRunIds, failedTests, flakyReason, ticketFlaky, type FlakyGate} from './flaky-gate';
import {verifyPr, type VerifyOptions} from './verify';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

const ok = (name: string) => ({__typename: 'CheckRun', name, status: 'COMPLETED', conclusion: 'SUCCESS'});
const bad = (name: string) => ({__typename: 'CheckRun', name, status: 'COMPLETED', conclusion: 'FAILURE'});
const LOG = 'test\tRun tests\t2026-01-01T00:00:00.0000000Z (fail) clock > reads the wall clock [1.20ms]\n';

interface Opts {
  rerunFails?: boolean;
  noRuns?: boolean;
  gatesResults?: boolean[];
}

function setup(rollups: unknown[], o: Opts = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-flaky-gate-')));
  dirs.push(root);
  const calls: string[] = [];
  const flaky: FlakyGate[] = [];
  const gatesResults = [...(o.gatesResults ?? [])];
  let views = 0;
  const run: CommandRunner = cmd => {
    calls.push(cmd);
    if (cmd.startsWith('gh pr view') && cmd.includes('headRefOid')) {
      return JSON.stringify({number: 5, state: 'OPEN', headRefOid: 'abc1234', headRefName: 'feat/issue-9', body: '', baseRefName: 'main', statusCheckRollup: rollups[0]});
    }
    if (cmd.startsWith('gh pr view')) return JSON.stringify({statusCheckRollup: rollups[Math.min(++views, rollups.length - 1)]});
    if (cmd.startsWith('gh issue view')) return '## Acceptance\n- [ ] Gates green\n- [ ] other thing\n';
    if (cmd.startsWith('gh run list')) return o.noRuns ? '[]' : JSON.stringify([{databaseId: 77, conclusion: 'failure'}, {databaseId: 78, conclusion: 'success'}]);
    if (cmd.startsWith('gh run view')) return LOG;
    if (cmd.startsWith('gh run rerun')) {
      if (o.rerunFails) throw new Error('Resource not accessible by integration');
      return '';
    }
    if (cmd.includes('run-the-gates')) {
      if (gatesResults.length > 0 && !gatesResults.shift()) throw new Error('(fail) clock > reads the wall clock [1.20ms]');
      return '';
    }
    return '';
  };
  const agent: AgentRunner = {
    async run() {
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
    onFlaky: f => flaky.push(f),
  };
  return {run, agent, opts, calls, flaky};
}

const gateEntry = (r: Awaited<ReturnType<typeof verifyPr>>) => r.entries.find(x => x.criterion === 'c1')!;

describe('a failed gate is run once more', () => {
  test('a failed CI check on the PR head is rerun once before Gates green is decided', async () => {
    const f = setup([[ok('build'), bad('test')], [ok('build'), ok('test')]]);
    await verifyPr(f.run, f.agent, f.opts);
    expect(f.calls.filter(c => c.startsWith('gh run rerun'))).toEqual(['gh run rerun 77 --failed']);
    expect(f.calls.some(c => c.startsWith('gh run list --commit abc1234'))).toBe(true);
  });

  test('Gates green is met when the rerun passes, and a flaky_gate event names the check', async () => {
    const f = setup([[ok('build'), bad('test')], [ok('build'), ok('test')]]);
    const e = gateEntry(await verifyPr(f.run, f.agent, f.opts));
    expect(e.verdict).toBe('met');
    expect(f.flaky).toEqual([{pr: 5, head: 'abc1234', check: 'test', tests: ['clock > reads the wall clock']}]);
    expect(flakyReason(f.flaky[0])).toBe('PR #5: test (clock > reads the wall clock)');
  });

  test('Gates green is not_met when the rerun fails too', async () => {
    const f = setup([[bad('test')], [bad('test')]]);
    const e = gateEntry(await verifyPr(f.run, f.agent, f.opts));
    expect(e.verdict).toBe('not_met');
    expect(f.flaky).toEqual([]);
  });

  test('a head whose failed check was already rerun is not rerun again', async () => {
    const f = setup([[bad('test')], [bad('test')]]);
    await verifyPr(f.run, f.agent, f.opts);
    const e = gateEntry(await verifyPr(f.run, f.agent, f.opts));
    expect(f.calls.filter(c => c.startsWith('gh run rerun')).length).toBe(1);
    expect(e.verdict).toBe('not_met');
  });

  test('Gates green is not_met when the rerun cannot be started', async () => {
    const f = setup([[bad('test')]], {rerunFails: true});
    const e = gateEntry(await verifyPr(f.run, f.agent, f.opts));
    expect(e.verdict).toBe('not_met');
    expect(e.evidence.map(x => x.ref).join('\n')).toContain('rerun not started');
    const none = setup([[bad('test')]], {noRuns: true});
    expect(gateEntry(await verifyPr(none.run, none.agent, none.opts)).verdict).toBe('not_met');
  });

  test("with no CI, a failed gates command runs once more in the verifier's copy", async () => {
    const f = setup([[]], {gatesResults: [false, true]});
    const e = gateEntry(await verifyPr(f.run, f.agent, {...f.opts, gates: 'run-the-gates'}));
    expect(f.calls.filter(c => c.includes('run-the-gates')).length).toBe(2);
    expect(e.verdict).toBe('met');
    expect(f.flaky).toEqual([{pr: 5, head: 'abc1234', check: 'the gates command', tests: ['clock > reads the wall clock']}]);
    const twice = setup([[]], {gatesResults: [false, false]});
    expect(gateEntry(await verifyPr(twice.run, twice.agent, {...twice.opts, gates: 'run-the-gates'})).verdict).toBe('not_met');
  });
});

describe('a flaky gate is ticketed once', () => {
  const flaky: FlakyGate = {pr: 5, head: 'abc1234', check: 'test', tests: ['clock > reads the wall clock']};

  test('a flaky gate files one ticket, and a second sighting comments on the open ticket', () => {
    const calls: string[] = [];
    let open: {number: number; title: string}[] = [];
    const run: CommandRunner = cmd => {
      calls.push(cmd);
      if (cmd.startsWith('gh issue list')) return JSON.stringify(open);
      if (cmd.startsWith('gh issue create')) open = [{number: 50, title: 'Make the flaky gate "test" deterministic'}];
      return '';
    };
    expect(ticketFlaky(run, flaky, 'ready-for-agent')).toBe('filed');
    expect(ticketFlaky(run, flaky, 'ready-for-agent')).toBe('commented');
    expect(calls.filter(c => c.startsWith('gh issue create')).length).toBe(1);
    expect(calls.find(c => c.startsWith('gh issue create'))).toContain("--label flaky-gate --label 'ready-for-agent'");
    expect(calls.find(c => c.startsWith('gh issue comment 50'))).toContain('Seen again');
  });
});

describe('the pure readers', () => {
  test('failedRunIds keeps the runs that did not succeed', () => {
    expect(failedRunIds(JSON.stringify([{databaseId: 1, conclusion: 'failure'}, {databaseId: 2, conclusion: 'success'}]))).toEqual([1]);
    expect(failedRunIds('not json')).toEqual([]);
  });

  test('failedTests names each failed test once', () => {
    expect(failedTests('(fail) a [1ms]\n(fail) a [1ms]\nFAIL b\nok c')).toEqual(['a', 'b']);
  });
});
