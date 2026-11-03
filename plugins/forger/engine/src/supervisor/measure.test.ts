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
    expect(parseIterationLog(log())).toEqual({iteration: 3, ticket: 'alpha_ticket', elapsedSeconds: 120, cause: 'ok', status: null});
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
  test('reads the decided status when the log carries one', () => {
    expect(parseIterationLog(log({status: 'off-pick'}))?.status).toBe('off-pick');
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
    {iteration: 1, ticket: 'alpha_ticket', elapsedSeconds: 100, cause: 'timeout', status: 'timeout'},
    {iteration: 2, ticket: 'alpha_ticket', elapsedSeconds: 50, cause: 'ok', status: 'off-pick'},
    {iteration: 3, ticket: 'beta', elapsedSeconds: 10, cause: 'ok', status: 'completed'},
    {iteration: 4, ticket: null, elapsedSeconds: 5, cause: 'signal', status: 'declined'},
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
  test('shares of off-pick and declined runs over the window', () => {
    const m = computeMeasures(base);
    expect(m.pick).toEqual({off_pick: 1, off_pick_share: 0.25, declined: 1, declined_share: 0.25});
    const last2 = computeMeasures({...base, last: 2});
    expect(last2.pick).toEqual({off_pick: 0, off_pick_share: 0, declined: 1, declined_share: 0.5});
  });
  test('a log without a status counts toward neither share', () => {
    const m = computeMeasures({...base, iterations: base.iterations.map(i => ({...i, status: null}))});
    expect(m.pick).toEqual({off_pick: 0, off_pick_share: 0, declined: 0, declined_share: 0});
  });
  test('no runs gives zero shares, not NaN', () => {
    expect(computeMeasures({...base, iterations: [], events: []}).pick.off_pick_share).toBe(0);
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
    expect(formatMeasures(computeMeasures(base))).toContain('pick: off-pick 25% (1), declined 25% (1)');
  });
});

describe('verification measures', () => {
  const rec = (pr: number, ticket: string, decision: 'pass' | 'block' | 'unclear') =>
    ({pr, head: `h${pr}${decision}`, ticket, verifier: 'v', decision, entries: [], problems: [], at: 'now'});
  const its: IterationRecord[] = [
    {iteration: 1, ticket: 'issue-1', elapsedSeconds: 1, cause: 'ok', status: 'completed'},
    {iteration: 2, ticket: 'issue-2', elapsedSeconds: 1, cause: 'ok', status: 'merged-red'},
    {iteration: 3, ticket: 'issue-3', elapsedSeconds: 1, cause: 'ok', status: 'completed'},
    {iteration: 4, ticket: 'issue-4', elapsedSeconds: 1, cause: 'ok', status: 'completed'},
  ];
  const verdicts = [
    rec(11, 'issue-1', 'pass'),
    rec(12, 'issue-2', 'pass'),
    rec(13, 'issue-3', 'block'),
    rec(13, 'issue-3', 'pass'),
    rec(14, 'issue-4', 'unclear'),
    rec(99, 'issue-outside', 'block'),
  ];
  const inputs = {iterations: its, budgets: [], events: [], ciRuns: [], verdicts, last: null};

  test('blocked, passed and later-failed runs yield the expected shares', () => {
    const v = computeMeasures(inputs).verification;
    expect(v.verified).toBe(4);
    expect(v.blocked).toBe(2);
    expect(v.blocked_share).toBe(0.5);
    expect(v.passed).toBe(3);
    expect(v.passed_then_failed).toBe(1);
    expect(v.passed_then_failed_share).toBeCloseTo(1 / 3);
  });

  test('no verdicts is zero shares, not NaN', () => {
    const v = computeMeasures({...inputs, verdicts: undefined}).verification;
    expect(v).toEqual({verified: 0, blocked: 0, blocked_share: 0, passed: 0, passed_then_failed: 0, passed_then_failed_share: 0});
  });

  test('the window limits which tickets count', () => {
    expect(computeMeasures({...inputs, last: 1}).verification.verified).toBe(1);
  });

  test('the table reports both shares', () => {
    expect(formatMeasures(computeMeasures(inputs))).toContain('verification: blocked 50% (2 of 4), passed then failed 33% (1 of 3)');
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
