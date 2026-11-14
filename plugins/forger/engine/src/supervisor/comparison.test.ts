import {describe, expect, test} from 'bun:test';

import {buildComparisonReport, diffReports} from './comparison';
import {computeMeasures, reworkMeasures, type IterationRecord, type MeasureInputs} from './measure';

const it = (iteration: number, ticket: string, status: string, cause: IterationRecord['cause'] = 'ok'): IterationRecord => ({
  iteration,
  ticket,
  elapsedSeconds: 60,
  cause,
  status,
});

const base: MeasureInputs = {iterations: [], budgets: [], events: [], ciRuns: [], last: null};
const ev = (event: string, iteration = 1) => ({event, at: 't', iteration, ticket: null, reason: null}) as MeasureInputs['events'][number];

describe('reworkMeasures', () => {
  const cases: Array<[string, IterationRecord[], {merged: number; redone: number}]> = [
    ['nothing', [], {merged: 0, redone: 0}],
    ['one clean merge', [it(1, 'a', 'completed')], {merged: 1, redone: 0}],
    ['merged twice', [it(1, 'a', 'completed'), it(2, 'a', 'completed')], {merged: 1, redone: 1}],
    ['failed after merge', [it(1, 'a', 'completed'), it(2, 'a', 'merged-red')], {merged: 1, redone: 1}],
    ['failed before merge is ordinary retry', [it(1, 'a', 'failed'), it(2, 'a', 'completed')], {merged: 1, redone: 0}],
    ['other tickets do not mix', [it(1, 'a', 'completed'), it(2, 'b', 'failed')], {merged: 1, redone: 0}],
  ];
  for (const [name, input, want] of cases) test(name, () => expect(reworkMeasures(input)).toEqual(want));
});

describe('buildComparisonReport', () => {
  test('an empty run reports zeros and an unknown cost', () => {
    expect(buildComparisonReport(computeMeasures(base))).toEqual({
      tickets_merged: 0,
      failure_causes: {},
      cost_per_merged_ticket: null,
      cost_unknown_tickets: 0,
      rework: {ci_extra_rounds: 0, blocked_prs: 0, rerun_after_conflict: 0, redone_tickets: 0},
      owner_interventions: {total: 0, by_event: {}},
    });
  });

  test('the five measures from one run', () => {
    const m = computeMeasures({
      ...base,
      iterations: [it(1, 'a', 'completed'), it(2, 'b', 'completed'), it(3, 'c', 'failed', 'timeout')],
      budgets: [
        {ticket: 'a', model: 'm', budgetUsd: 10, sessionId: 'sa'},
        {ticket: 'b', model: 'm', budgetUsd: 20, sessionId: 'sb'},
        {ticket: 'c', model: 'm', budgetUsd: 5, sessionId: 'sc'},
      ],
      sessionCosts: {sa: 1, sb: 2, sc: 0.5},
      ciRuns: [
        {headBranch: 'feat/a', event: 'pull_request'},
        {headBranch: 'feat/a', event: 'pull_request'},
        {headBranch: 'feat/a', event: 'pull_request'},
        {headBranch: 'feat/b', event: 'pull_request'},
      ],
      events: [ev('halted', 1), ev('completed', 2), ev('merged_red', 3)],
    });
    expect(buildComparisonReport(m)).toEqual({
      tickets_merged: 2,
      failure_causes: {timeout: 1},
      cost_per_merged_ticket: 1.75,
      cost_unknown_tickets: 0,
      rework: {ci_extra_rounds: 2, blocked_prs: 0, rerun_after_conflict: 0, redone_tickets: 0},
      owner_interventions: {total: 2, by_event: {halted: 1, merged_red: 1}},
    });
  });
});

describe('cost per merged ticket', () => {
  const run = (cap: number, costs: Record<string, number | null>, statuses = ['completed', 'completed']) =>
    buildComparisonReport(
      computeMeasures({
        ...base,
        iterations: statuses.map((s, i) => it(i + 1, 't' + i, s)),
        budgets: statuses.map((_, i) => ({ticket: 't' + i, model: 'm', budgetUsd: cap, sessionId: 's' + i})),
        sessionCosts: costs,
      })
    );

  test("the report's cost per merged ticket is the spend of the period over the merged tickets", () => {
    expect(run(18, {s0: 1, s1: 3}).cost_per_merged_ticket).toBe(2);
  });

  test('spend on a ticket that did not merge counts toward the cost per merged ticket', () => {
    expect(run(18, {s0: 1, s1: 3}, ['completed', 'failed']).cost_per_merged_ticket).toBe(4);
  });

  test("the report's cost is unknown when a ticket's cost is unknown, and it counts those tickets", () => {
    const r = run(18, {s0: 1, s1: null});
    expect(r.cost_per_merged_ticket).toBeNull();
    expect(r.cost_unknown_tickets).toBe(1);
  });

  test('two runs with the same cap and different spend differ on cost per merged ticket', () => {
    const d = diffReports(run(18, {s0: 1, s1: 1}), run(18, {s0: 2, s1: 4}));
    expect(d.cost_per_merged_ticket).toEqual({a: 1, b: 3, delta: 2});
  });
});

describe('owner interventions coverage', () => {
  const runs = [it(1, 'a', 'completed'), it(2, 'b', 'completed')];

  test('a run with only picked and merged records is covered and reports zero owner interventions', () => {
    const m = computeMeasures({...base, iterations: runs, events: [], records: [ev('picked', 1), ev('merged', 1), ev('picked', 2), ev('merged', 2)]});
    expect(m.interventions_unknown).toBeNull();
    expect(buildComparisonReport(m).owner_interventions).toEqual({total: 0, by_event: {}});
  });

  test('a run with no record of any kind is still reported as unknown', () => {
    const m = computeMeasures({...base, iterations: runs, events: [], records: [ev('picked', 1), ev('merged', 1)]});
    expect(m.interventions_unknown).toContain('1 of 2');
  });

  test('the comparison report carries the reason when owner interventions are unknown', () => {
    const m = computeMeasures({...base, iterations: runs, events: [ev('halted', 1)]});
    expect(buildComparisonReport(m).owner_interventions).toEqual({total: null, by_event: {}, unknown_reason: m.interventions_unknown as string});
  });
});

describe('diffReports', () => {
  const report = (merged: number, cost: number | null, causes: Record<string, number>, halted: number) => ({
    tickets_merged: merged,
    failure_causes: causes,
    cost_per_merged_ticket: cost,
    cost_unknown_tickets: 0,
    rework: {ci_extra_rounds: merged, blocked_prs: 0, rerun_after_conflict: 0, redone_tickets: 0},
    owner_interventions: {total: halted, by_event: (halted === 0 ? {} : {halted}) as Record<string, number>},
  });

  test('is the per-measure delta from the first report to the second', () => {
    const d = diffReports(report(4, 10, {timeout: 2}, 1), report(6, 8, {signal: 1}, 0));
    expect(d.tickets_merged).toEqual({a: 4, b: 6, delta: 2});
    expect(d.cost_per_merged_ticket).toEqual({a: 10, b: 8, delta: -2});
    expect(d.failure_causes).toEqual({signal: {a: 0, b: 1, delta: 1}, timeout: {a: 2, b: 0, delta: -2}});
    expect(d.rework.ci_extra_rounds).toEqual({a: 4, b: 6, delta: 2});
    expect(d.owner_interventions.total).toEqual({a: 1, b: 0, delta: -1});
    expect(d.owner_interventions.by_event).toEqual({halted: {a: 1, b: 0, delta: -1}});
  });

  test('an unknown cost on either side has no delta', () => {
    expect(diffReports(report(1, null, {}, 0), report(1, 5, {}, 0)).cost_per_merged_ticket).toEqual({a: null, b: 5, delta: null});
  });

  test('a report diffed with itself is all zero', () => {
    const r = report(3, 7, {timeout: 1}, 2);
    const d = diffReports(r, r);
    expect(d.tickets_merged.delta).toBe(0);
    expect(d.failure_causes.timeout.delta).toBe(0);
    expect(d.cost_per_merged_ticket.delta).toBe(0);
  });

  test('the diff of two reports gives no delta for owner interventions when either is unknown', () => {
    const known = report(1, 1, {}, 1);
    const unknown = {...known, owner_interventions: {total: null, by_event: {}, unknown_reason: 'gap'}};
    expect(diffReports(known, unknown).owner_interventions.total).toEqual({a: 1, b: null, delta: null});
    expect(diffReports(unknown, known).owner_interventions.total).toEqual({a: null, b: 1, delta: null});
  });
});
