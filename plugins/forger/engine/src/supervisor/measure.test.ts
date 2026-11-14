import {describe, expect, test} from 'bun:test';

import {
  type IterationRecord,
  type RuleRecord,
  ciRoundsByBranch,
  computeMeasures,
  draftUpstreamIssue,
  formatMeasures,
  branchTicketId,
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
    expect(parseIterationLog(log())).toEqual({iteration: 3, ticket: 'alpha_ticket', elapsedSeconds: 120, cause: 'ok', status: null, startedAt: null, parallelism: null});
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
  test.each([
    ['feat/alpha-ticket', 'alpha_ticket'],
    ['feat/a', 'a'],
    ['feat/issue-72', 'issue-72'],
    ['fix/issue-5', 'issue-5'],
    ['feat/issue-72-extra', 'issue_72_extra'],
  ])('branch %s builds ticket %s', (branch, ticket) => {
    expect(branchTicketId(branch)).toBe(ticket);
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

  test('a ticket carries the plan of its latest run that kept one, and the report shows it', () => {
    const early = {stages: [{id: 'build', slots: [{slot: 'test_first', invoke: 'builtin' as const, target: null}]}]};
    const late = {stages: [{id: 'build', slots: [{slot: 'test_first', invoke: 'skill' as const, target: 'tdd'}]}]};
    const m = computeMeasures({...base, iterations: [{...its[0], plan: early}, {...its[1], plan: late}, its[2]]});
    const alpha = m.tickets.find(t => t.ticket === 'alpha_ticket');
    expect(alpha?.plan).toEqual(late);
    expect(m.tickets.find(t => t.ticket === 'beta')?.plan).toBeUndefined();
    expect(formatMeasures(m)).toContain('    plan build: test_first=skill tdd');
  });
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
      {ticket: 'alpha_ticket', runs: 2, seconds: 150, budget_cap_usd: 10, cost_usd: null, ci_rounds: 2},
      {ticket: 'beta', runs: 1, seconds: 10, budget_cap_usd: null, cost_usd: null, ci_rounds: null},
    ]);
    expect(m.ci_rounds_unmatched).toEqual({'feat/stray': 1});
  });
  test('a GitHub ticket branch attaches its CI rounds', () => {
    const m = computeMeasures({
      ...base,
      iterations: [{...base.iterations[0], ticket: 'issue-72'}],
      ciRuns: [{headBranch: 'feat/issue-72', event: 'pull_request'}],
    });
    expect(m.tickets[0].ci_rounds).toBe(1);
    expect(m.ci_rounds_unmatched).toEqual({});
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
    expect(formatMeasures(computeMeasures(base))).toContain('alpha_ticket: 2 run(s), 150s, cap $10, cost unknown, CI rounds 2');
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

describe('session cost per ticket', () => {
  const sid = (n: number) => `0000000${n}-0000-0000-0000-000000000000`;
  const it = (iteration: number, ticket: string): IterationRecord => ({iteration, ticket, elapsedSeconds: 1, cause: 'ok', status: 'completed'});
  const inputs = (budgets: {ticket: string; sessionId?: string}[], sessionCosts?: Record<string, number | null>) => ({
    iterations: [it(1, 'issue-1'), it(2, 'issue-2'), it(3, 'issue-3')],
    budgets: budgets.map(b => ({...b, model: 'opus', budgetUsd: 20})),
    sessionCosts,
    events: [],
    ciRuns: [],
    last: null,
  });
  const costs = (m: ReturnType<typeof computeMeasures>) => Object.fromEntries(m.tickets.map(t => [t.ticket, t.cost_usd]));

  test('joins a ticket to its session costs and sums its sessions', () => {
    const m = computeMeasures(inputs([{ticket: 'issue-1', sessionId: sid(1)}, {ticket: 'issue-1', sessionId: sid(2)}, {ticket: 'issue-2', sessionId: sid(3)}], {[sid(1)]: 1.5, [sid(2)]: 0.25, [sid(3)]: 0}));
    expect(costs(m)).toEqual({'issue-1': 1.75, 'issue-2': 0, 'issue-3': null});
  });
  test('a session without a transcript makes the ticket unknown, never the cap or zero', () => {
    const m = computeMeasures(inputs([{ticket: 'issue-1', sessionId: sid(1)}, {ticket: 'issue-1', sessionId: sid(2)}, {ticket: 'issue-2', sessionId: sid(3)}], {[sid(1)]: 1.5, [sid(2)]: null}));
    expect(costs(m)).toEqual({'issue-1': null, 'issue-2': null, 'issue-3': null});
    expect(m.tickets[0].budget_cap_usd).toBe(40);
  });
  test('a work log line without a session id is unknown', () => {
    expect(costs(computeMeasures(inputs([{ticket: 'issue-1'}], {})))['issue-1']).toBeNull();
  });
  test('parseBudgets reads the session id when the line carries one', () => {
    const text = `[t] [INFO] Ticket: issue-1 [opus, $20] session ${sid(1)}\n[t] [INFO] Ticket: issue-2 [opus, $20]`;
    expect(parseBudgets(text)).toEqual([
      {ticket: 'issue-1', model: 'opus', budgetUsd: 20, sessionId: sid(1)},
      {ticket: 'issue-2', model: 'opus', budgetUsd: 20},
    ]);
  });
  test('the text report shows cost beside the cap', () => {
    const m = computeMeasures(inputs([{ticket: 'issue-1', sessionId: sid(1)}], {[sid(1)]: 1.5}));
    expect(formatMeasures(m)).toContain('cap $20, cost $1.50,');
  });
});

describe('measures carry the journey share', () => {
  const base = {iterations: [], budgets: [], events: [], ciRuns: [], last: null};
  const changes = {prs: [{number: 1, order: 0, title: 't', body: '', closes: null, ranges: [{file: 'src/a.ts', start: 1, end: 2}], replaced: [{file: 'docs/x.md', start: 1, end: 1}]}], issues: [], picks: [], window: 5};

  test('with no journeys file the measure is null', () => {
    const m = computeMeasures({...base, changes});
    expect(m.journeys).toBeNull();
    expect(formatMeasures(m)).not.toContain('journeys:');
  });

  test('a file the PR only deleted from still counts as changed', () => {
    const m = computeMeasures({...base, changes, journeys: [{name: 'docs', paths: ['docs/**']}]});
    expect(m.journeys).toEqual({merged: 1, touched_a_journey: 1, by_journey: {docs: 1}, upkeep: 0});
    expect(formatMeasures(m)).toContain('journeys: 1 of 1');
  });
});

describe('worker denials', () => {
  const run = (iteration: number) => parseIterationLog(log({iteration, ticket: `issue-${iteration}`})) as IterationRecord;
  const ev = (name: 'worker_denied' | 'completed', iteration: number, reason: string | null = null) => terminalEvent(name, iteration, `issue-${iteration}`, reason);
  const base = {budgets: [], ciRuns: [], last: null};

  test('worker denials are counted by rule and by ticket within the period', () => {
    const denials = [ev('worker_denied', 1, 'merge: first'), ev('worker_denied', 1, 'merge: second'), ev('worker_denied', 2, 'leave-worktree: cd /x: y')];
    const m = computeMeasures({...base, iterations: [run(1), run(2)], events: [ev('completed', 1), ev('completed', 2)], records: [...denials, ev('completed', 1), ev('completed', 2)], denials});
    expect(m.worker_denials).toEqual({total: 3, by_rule: {merge: 2, 'leave-worktree': 1}, by_ticket: {'issue-1': 2, 'issue-2': 1}});
    expect(m.events).toEqual({completed: 2});
  });

  test('a period with no refused call reports zero worker denials', () => {
    const m = computeMeasures({...base, iterations: [run(1)], events: [ev('completed', 1)]});
    expect(m.worker_denials).toEqual({total: 0, by_rule: {}, by_ticket: {}});
    expect(formatMeasures(m)).toContain('worker denials: none');
  });

  test('worker denials are unknown when the events file does not cover the period', () => {
    const m = computeMeasures({...base, iterations: [run(1), run(2)], events: [ev('completed', 1)]});
    expect(m.worker_denials).toBeNull();
    expect(formatMeasures(m)).toContain(`worker denials: unknown (${m.interventions_unknown})`);
  });

  test('the readable measure prints the worker denials line with each rule and its count', () => {
    const denials = [ev('worker_denied', 1, 'merge: a'), ev('worker_denied', 1, 'merge: b'), ev('worker_denied', 1, 'push: c')];
    const m = computeMeasures({...base, iterations: [run(1)], events: [ev('completed', 1)], denials});
    expect(formatMeasures(m)).toContain('worker denials: 3 (merge 2, push 1)');
  });

  test('a denial outside the last N runs is not counted', () => {
    const denials = [ev('worker_denied', 1, 'merge: a'), ev('worker_denied', 2, 'push: b')];
    const m = computeMeasures({...base, iterations: [run(1), run(2)], events: [ev('completed', 1), ev('completed', 2)], denials, last: 1});
    expect(m.worker_denials).toEqual({total: 1, by_rule: {push: 1}, by_ticket: {'issue-2': 1}});
  });
});
