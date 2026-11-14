import {describe, expect, test} from 'bun:test';

import type {Measures} from './measure';
import {APPROVAL_POLICY, approvalFor, buildReport, formatReport, orient} from './supervisor';
import {buildStatus, conflictHalt} from '../loop';
import {defaultState} from '../loop';

function status(over: {alive?: boolean; pid?: number | null; halted?: boolean; remaining?: number; ticket?: string | null; done?: string[]} = {}) {
  const state = {...defaultState(), in_flight: over.ticket ? [{ticket: over.ticket, pid: null, session_id: 's', snapshot: null, started_at: ''}] : [], completed_tasks: over.done ?? []};
  return buildStatus({
    state,
    isAlive: () => false,
    runnerPid: over.pid === undefined ? (over.alive ? 42 : null) : over.pid,
    runnerAlive: over.alive ?? false,
    halted: over.halted ?? false,
    remaining: over.remaining ?? 3,
    workable: 1,
    next: 'next-one',
    maxStallIterations: 5,
    maxConsecutiveFailures: 3,
    spendLimit: 'none' as const,
  });
}

const base = {branch: 'main', baseBranch: 'main', haltReason: null};

describe('orient', () => {
  test('a live runner is attached to, never doubled', () => {
    expect(orient({...base, status: status({alive: true})}).action).toBe('attach');
  });
  test('dependencies the text and the tracker disagree on are anomalies', () => {
    const plan = orient({...base, status: status(), backlogAnomalies: ['#82 lists #81 under Blocked by but it is not linked as blocked-by']});
    expect(plan.anomalies).toEqual(['#82 lists #81 under Blocked by but it is not linked as blocked-by']);
  });
  test('no runner and work left starts one', () => {
    expect(orient({...base, status: status()}).action).toBe('start');
  });
  test('a live lease held elsewhere is the reason not to start', () => {
    const lease = {state: 'live_elsewhere', holder: 'desk:9:aa', host: 'desk', expires_at: '2026-01-01T00:25:00.000Z'} as const;
    const plan = orient({...base, status: status(), lease});
    expect(plan.action).toBe('nothing_to_do');
    expect(plan.lease).toEqual(lease);
    expect(plan.reason).toContain('desk');
    expect(plan.reason).toContain('2026-01-01T00:25:00.000Z');
  });
  test('a stale local lease is an anomaly and the loop still starts', () => {
    const lease = {state: 'stale_local', holder: 'me:9:aa', host: 'me', expires_at: '2026-01-01T00:25:00.000Z'} as const;
    const plan = orient({...base, status: status(), lease});
    expect(plan.action).toBe('start');
    expect(plan.anomalies.join('\n')).toContain('me:9:aa');
  });
  test('an empty backlog is nothing to do', () => {
    expect(orient({...base, status: status({remaining: 0})}).action).toBe('nothing_to_do');
  });
  test('tickets left but none workable is nothing to do, with the blockers', () => {
    const blocked = {...status({remaining: 1}), workable: 0};
    const plan = orient({...base, status: blocked, blockers: ['issue-150 blocked by issue-156 (needs_human)']});
    expect(plan.action).toBe('nothing_to_do');
    expect(plan.blockers).toEqual(['issue-150 blocked by issue-156 (needs_human)']);
    const report = buildReport({status: blocked, plan, branch: 'main', baseBranch: 'main'});
    expect(report.waiting_on_owner.map(w => w.question)).toEqual(['Nothing is workable: issue-150 blocked by issue-156 (needs_human)']);
  });
  test('a halt wins over a live runner and quotes its reason', () => {
    const p = orient({...base, status: status({alive: true, halted: true}), haltReason: ' cut off before merge\n'});
    expect(p.action).toBe('surface_halt');
    expect(p.reason).toBe('cut off before merge');
  });
  test('a missing loop label is an anomaly', () => {
    const p = orient({...base, status: status(), missingLabels: ['needs-info']});
    expect(p.anomalies.join(' ')).toContain('needs-info');
    expect(orient({...base, status: status(), missingLabels: []}).anomalies).toEqual([]);
  });
  test('a base branch that does not require forger/verify is an anomaly; unknown is not', () => {
    const p = orient({...base, status: status(), requiresVerify: false});
    expect(p.anomalies.join(' ')).toContain('does not require the forger/verify check');
    expect(orient({...base, status: status(), requiresVerify: true}).anomalies).toEqual([]);
    expect(orient({...base, status: status(), requiresVerify: null}).anomalies).toEqual([]);
  });
  test('a behind base branch is an anomaly with no engine alive, not with one', () => {
    const baseSync = {behind: 4, clean: true, onBase: true, changed: []};
    expect(orient({...base, status: status(), baseSync}).anomalies.join(' ')).toContain('behind origin/main');
    expect(orient({...base, status: status({alive: true}), baseSync}).anomalies).toEqual([]);
  });
  test('orient reports a checkout with uncommitted changes when no engine is alive', () => {
    const baseSync = {behind: 0, clean: false, onBase: true, changed: ['plugins/forger/engine/src/a.ts']};
    const text = orient({...base, status: status(), baseSync}).anomalies.join(' ');
    expect(text).toContain('plugins/forger/engine/src/a.ts');
    expect(text).toContain('leaves such a checkout as it is');
    expect(orient({...base, status: status({alive: true}), baseSync}).anomalies).toEqual([]);
  });
  test('orient does not say run brings the checkout up to date when it has uncommitted changes', () => {
    const baseSync = {behind: 4, clean: false, onBase: true, changed: ['a.ts']};
    const text = orient({...base, status: status(), baseSync}).anomalies.join(' ');
    expect(text).toContain('behind origin/main');
    expect(text).not.toContain('fast-forwards');
    expect(text).toContain('does not bring it up to date');
  });
  test('a dead runner off the base branch is an anomaly', () => {
    const p = orient({...base, branch: 'feat/x', status: status({pid: 9})});
    expect(p.anomalies.length).toBe(2);
  });
  test('a live runner on a feature branch is normal', () => {
    expect(orient({...base, branch: 'feat/x', status: status({alive: true})}).anomalies).toEqual([]);
  });
});

describe('approval policy', () => {
  test('matches the table: runner alone, halt owner, budget never', () => {
    expect(approvalFor('start_runner')).toBe('alone');
    expect(approvalFor('open_pr_for_pushed_branch')).toBe('alone_and_report');
    expect(approvalFor('clear_halt')).toBe('owner');
    expect(approvalFor('resume_after_known_recovery')).toBe('alone_and_report');
    expect(approvalFor('file_critique_tickets')).toBe('alone_and_report');
    expect(approvalFor('raise_budget')).toBe('never');
    expect(approvalFor('ui_approve')).toBe('owner');
  });
  test('an unlisted action needs the owner', () => {
    expect(approvalFor('something_new')).toBe('owner');
    expect(approvalFor('constructor')).toBe('owner');
  });
  test('principles, the approval table and blocking checks are owner-only', () => {
    for (const a of ['change_principle', 'change_approval_table', 'change_blocking_check'] as const) {
      expect(APPROVAL_POLICY[a]).toBe('owner');
    }
  });
});

describe('report recoveries', () => {
  test('lists recovered halts and recommends by halt kind', () => {
    const halted = {...status({alive: false, ticket: null, done: []}), halted: true};
    const plan = orient({...base, status: halted, haltReason: 'x'});
    const r = buildReport({status: halted, plan, branch: 'main', baseBranch: 'main', haltKind: 'timed_out', recovered: ['t1: PR #2 verified after the merge: pass']});
    expect(r.recovered).toEqual(['t1: PR #2 verified after the merge: pass']);
    expect(r.waiting_on_owner[0].recommendation).toContain('pushed a branch');
    expect(formatReport(r)).toContain('**Recovered by the engine**');
  });
});

describe('report on a conflict stop', () => {
  test('the report shows a conflict\'s options and the decide line to answer it', () => {
    const c = {constraint: 'the footer must fit', measured: '18 px of overflow', options: [{text: 'A - shrink', tradeoff: 'smaller type'}, {text: 'B - wrap', tradeoff: 'taller footer'}], recommend: 'B'};
    const reason = conflictHalt(344, c);
    const s = status({halted: true});
    const r = buildReport({status: s, plan: orient({...base, status: s, haltReason: reason}), branch: 'main', baseBranch: 'main'});
    const text = formatReport(r);
    expect(text).toContain('1. A - shrink (trade-off: smaller type)');
    expect(text).toContain('2. B - wrap (trade-off: taller footer)');
    expect(text).toContain('Recommendation: B');
    expect(r.waiting_on_owner[0].recommendation).toBe('decide 344 "<choice>"');
  });
});

describe('report', () => {
  test('in progress carries the real branch only while a runner works', () => {
    const live = status({alive: true, ticket: 't1', done: ['t0']});
    const r = buildReport({status: live, plan: orient({...base, branch: 'feat/t1', status: live}), branch: 'feat/t1', baseBranch: 'main', merged: ['#1 t0']});
    expect(r.merged).toEqual(['#1 t0']);
    expect(r.in_progress).toEqual([{ticket: 't1', branch: 'feat/t1'}]);
    expect(r.next).toEqual(['next-one']);
    expect(r.waiting_on_owner).toEqual([]);
  });
  test('every owner item has a recommendation and a reason', () => {
    const s = status({halted: true});
    const r = buildReport({status: s, plan: orient({...base, status: s, haltReason: 'x'}), branch: 'main', baseBranch: 'main'});
    expect(r.waiting_on_owner.length).toBe(1);
    for (const o of r.waiting_on_owner) {
      expect(o.recommendation).not.toBe('');
      expect(o.because).not.toBe('');
    }
  });
  test('the text has the four sections', () => {
    const s = status();
    const text = formatReport(buildReport({status: s, plan: orient({...base, status: s}), branch: 'main', baseBranch: 'main'}));
    for (const h of ['**Merged**', '**In progress**', '**Next**', '**Waiting on you**']) expect(text).toContain(h);
  });
  test('handed-over tickets are listed with the criteria at fault', () => {
    const s = status();
    const handed = [{ticket: 'issue-9', pr: 3, rounds: 2, open: [{criterion: 'c2', verdict: 'cannot_tell' as const}], reword: []}];
    const r = buildReport({status: s, plan: orient({...base, status: s}), branch: 'main', baseBranch: 'main', handedOver: handed});
    expect(r.handed_over).toEqual([{ticket: 'issue-9', pr: 3, criteria: ['c2 cannot_tell']}]);
    expect(formatReport(r)).toContain('issue-9 (PR #3): c2 cannot_tell');
  });
  test('the measures section appears only when measures are given', () => {
    const s = status();
    const input = {status: s, plan: orient({...base, status: s}), branch: 'main', baseBranch: 'main'};
    expect(buildReport(input).measures).toBeNull();
    expect(formatReport(buildReport(input))).not.toContain('**Measures**');
    const m = {tickets: [], owner_interventions: {total: 0, by_event: {}}, interventions_unknown: null, change_rework: null} as unknown as Measures;
    const r = buildReport({...input, measures: m});
    expect(r.measures?.owner_interventions.total).toBe(0);
    expect(formatReport(r)).toContain('**Measures**');
  });
});

describe('report flaky gates', () => {
  test('report lists the flaky gates of the run', () => {
    const plan = orient({...base, status: status()});
    const r = buildReport({status: status(), plan, branch: 'main', baseBranch: 'main', flakyGates: ['PR #5: test (clock > reads the wall clock)']});
    expect(r.flaky_gates).toEqual(['PR #5: test (clock > reads the wall clock)']);
    expect(formatReport(r)).toContain('**Flaky gates**\n- PR #5: test (clock > reads the wall clock)');
  });
});
