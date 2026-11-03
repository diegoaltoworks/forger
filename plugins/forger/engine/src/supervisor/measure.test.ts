import {describe, expect, test} from 'bun:test';

import {
  type IterationRecord,
  type RuleRecord,
  ciRoundsByBranch,
  computeMeasures,
  draftUpstreamIssue,
  formatMeasures,
  normalizeBranch,
  parseBudgets,
  parseIterationLog,
  renderRule,
  ruleFilePath,
  ruleProblem,
} from './measure';
import {formatIterationLog} from '../loop';
import {terminalEvent} from '../loop';

function log(over: Partial<Parameters<typeof formatIterationLog>[0]> = {}): string {
  return formatIterationLog({
    iteration: 3,
    ticket: 'alpha_ticket',
    elapsedSeconds: 120,
    exitCode: 0,
    signal: null,
    timedOut: false,
    timeoutMinutes: 45,
    output: 'done',
    ...over,
  });
}

describe('parseIterationLog', () => {
  test('reads the log the engine writes', () => {
    expect(parseIterationLog(log())).toEqual({iteration: 3, ticket: 'alpha_ticket', elapsedSeconds: 120, cause: 'ok'});
  });
  test('classifies each way a run ends', () => {
    expect(parseIterationLog(log({timedOut: true, exitCode: 1}))?.cause).toBe('timeout');
    expect(parseIterationLog(log({signal: 'SIGKILL', exitCode: 137}))?.cause).toBe('signal');
    expect(parseIterationLog(log({exitCode: 2}))?.cause).toBe('nonzero_exit');
  });
  test('no ticket picked is null; a foreign file is not a log', () => {
    expect(parseIterationLog(log({ticket: null}))?.ticket).toBeNull();
    expect(parseIterationLog('hello')).toBeNull();
  });
  test('output text cannot forge a header field', () => {
    const r = parseIterationLog(log({output: 'ticket: other\noutcome: exited with code 9'}));
    expect(r?.ticket).toBe('alpha_ticket');
    expect(r?.cause).toBe('ok');
  });
});

describe('parseBudgets', () => {
  test('reads ticket lines from the work log', () => {
    const text = '[t] [INFO] Ticket: alpha_ticket [opus, $33.75]\n[t] [INFO] other line\n[t] [INFO] Ticket: b [sonnet, $45]';
    expect(parseBudgets(text)).toEqual([
      {ticket: 'alpha_ticket', model: 'opus', budgetUsd: 33.75},
      {ticket: 'b', model: 'sonnet', budgetUsd: 45},
    ]);
  });
});

describe('CI rounds', () => {
  test('counts pull request runs per branch and ignores pushes to others', () => {
    const runs = [
      {headBranch: 'feat/a', event: 'pull_request'},
      {headBranch: 'feat/a', event: 'pull_request'},
      {headBranch: 'feat/a', event: 'push'},
      {headBranch: 'main', event: 'push'},
    ];
    expect(ciRoundsByBranch(runs)).toEqual({'feat/a': 2});
  });
  test('a branch name matches its ticket id', () => {
    expect(normalizeBranch('feat/alpha-ticket')).toBe('alpha_ticket');
  });
});

describe('computeMeasures', () => {
  const its: IterationRecord[] = [
    {iteration: 1, ticket: 'alpha_ticket', elapsedSeconds: 100, cause: 'timeout'},
    {iteration: 2, ticket: 'alpha_ticket', elapsedSeconds: 50, cause: 'ok'},
    {iteration: 3, ticket: 'beta', elapsedSeconds: 10, cause: 'ok'},
    {iteration: 4, ticket: null, elapsedSeconds: 5, cause: 'signal'},
  ];
  const base = {
    iterations: its,
    budgets: [{ticket: 'alpha_ticket', model: 'opus', budgetUsd: 10}],
    events: [terminalEvent('timed_out', 1, 'alpha_ticket', 'x'), terminalEvent('completed', 3, 'beta', null)],
    ciRuns: [
      {headBranch: 'feat/alpha-ticket', event: 'pull_request'},
      {headBranch: 'feat/alpha-ticket', event: 'pull_request'},
      {headBranch: 'feat/stray', event: 'pull_request'},
    ],
    last: null,
  };

  test('counts runs and failures by cause', () => {
    const m = computeMeasures(base);
    expect(m.runs).toEqual({total: 4, ok: 2, failed: 2, by_cause: {timeout: 1, signal: 1}});
    expect(m.events).toEqual({timed_out: 1, completed: 1});
  });
  test('time, cap and CI rounds per ticket', () => {
    const m = computeMeasures(base);
    expect(m.tickets).toEqual([
      {ticket: 'alpha_ticket', runs: 2, seconds: 150, budget_usd: 10, ci_rounds: 2},
      {ticket: 'beta', runs: 1, seconds: 10, budget_usd: null, ci_rounds: null},
    ]);
    expect(m.ci_rounds_unmatched).toEqual({'feat/stray': 1});
  });
  test('a window keeps only the last N iterations and the events within it', () => {
    const m = computeMeasures({...base, last: 2});
    expect(m.runs.total).toBe(2);
    expect(m.events).toEqual({completed: 1});
    expect(m.tickets.map(t => t.ticket)).toEqual(['beta']);
  });
  test('no iterations measures to zero', () => {
    const m = computeMeasures({...base, iterations: [], events: [], ciRuns: []});
    expect(m.runs.total).toBe(0);
    expect(formatMeasures(m)).toContain('runs: 0');
  });
  test('text output names every ticket', () => {
    expect(formatMeasures(computeMeasures(base))).toContain('alpha_ticket: 2 run(s), 150s, cap $10, CI rounds 2');
  });
});

describe('rule record', () => {
  const rule: RuleRecord = {
    name: 'push-before-slow-steps',
    description: 'push as soon as gates are green',
    type: 'feedback',
    rule: 'Push the branch the moment the gates are green.',
    ownerWords: 'do not lose finished work',
    date: '2026-11-03',
    why: 'a timeout lost a finished ticket',
    howToApply: 'before opening the PR',
    enforcedBy: '',
  };
  test('renders the shape of templates/rule.md', () => {
    const out = renderRule(rule);
    expect(out).toContain('---\nname: push-before-slow-steps\ndescription: push as soon as gates are green\ntype: feedback\n---');
    expect(out).toContain('Owner (2026-11-03): "do not lose finished work"');
    expect(out).toContain('**Enforced by:** nothing yet');
    expect(ruleFilePath(rule.name)).toBe('.forger/rules/push-before-slow-steps.md');
  });
  test('rejects what cannot be a record', () => {
    expect(ruleProblem(rule)).toBeNull();
    expect(ruleProblem({...rule, name: 'Bad Name'})).toContain('slug');
    expect(ruleProblem({...rule, name: '../x'})).toContain('slug');
    expect(ruleProblem({...rule, type: 'other' as never})).toContain('type');
    expect(ruleProblem({...rule, date: 'today'})).toContain('date');
    expect(ruleProblem({...rule, why: ' '})).toContain('why');
  });
});

describe('draftUpstreamIssue', () => {
  test('carries the lesson and its evidence', () => {
    const d = draftUpstreamIssue({title: ' A lesson ', lesson: 'It holds everywhere.', evidence: ['iteration 4 timed out']});
    expect(d.title).toBe('A lesson');
    expect(d.body).toContain('## Evidence\n\n- iteration 4 timed out');
  });
  test('refuses a lesson with no evidence', () => {
    expect(() => draftUpstreamIssue({title: 't', lesson: 'l', evidence: []})).toThrow('evidence');
  });
});
