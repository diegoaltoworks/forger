import {describe, expect, test} from 'bun:test';

import {APPROVAL_POLICY, approvalFor, buildReport, formatReport, orient} from './supervisor';
import {buildStatus} from '../loop';
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
  });
}

const base = {branch: 'main', baseBranch: 'main', haltReason: null};

describe('orient', () => {
  test('a live runner is attached to, never doubled', () => {
    expect(orient({...base, status: status({alive: true})}).action).toBe('attach');
  });
  test('no runner and work left starts one', () => {
    expect(orient({...base, status: status()}).action).toBe('start');
  });
  test('an empty backlog is nothing to do', () => {
    expect(orient({...base, status: status({remaining: 0})}).action).toBe('nothing_to_do');
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
    expect(approvalFor('raise_budget')).toBe('never');
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

describe('report', () => {
  test('in progress carries the real branch only while a runner works', () => {
    const live = status({alive: true, ticket: 't1', done: ['t0']});
    const r = buildReport({status: live, plan: orient({...base, branch: 'feat/t1', status: live}), branch: 'feat/t1', baseBranch: 'main'});
    expect(r.merged).toEqual(['t0']);
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
});
