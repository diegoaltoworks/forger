import {describe, expect, test} from 'bun:test';

import type {PipelinePlan} from './resolve';
import {formatStoredPlan, issueOfTicket, parsePlanLine, planLine, storedPlan} from './stored-plan';

const plan: PipelinePlan = {
  ticket: 'issue-1',
  flavour: 'default',
  disabled: [],
  problems: [],
  stages: [
    {id: 'build', command: 'auto-ticket', inputs: [], gate: 'gates', skipped: [], slots: [
      {slot: 'test_first', contract: 'tests_written', invoke: 'skill', target: 'tdd', reason: 'r'},
      {slot: 'diagnose', contract: 'diagnosis', invoke: 'builtin', target: 'step', on: 'gate_red', reason: 'r'},
    ]},
    {id: 'merge', command: 'auto-ticket', inputs: [], gate: 'merge', skipped: [], slots: []},
  ],
} as PipelinePlan;

describe('issueOfTicket', () => {
  test('reads the number of an issue ticket and nothing else', () => {
    expect(issueOfTicket('issue-155')).toBe(155);
    expect(issueOfTicket('engine_timeout_kills_group')).toBeNull();
    expect(issueOfTicket('issue-12-x')).toBeNull();
    expect(issueOfTicket(null)).toBeNull();
  });
});

describe('stored plan', () => {
  test('keeps the skill chosen per slot and drops the reasons', () => {
    expect(storedPlan(plan)).toEqual({stages: [
      {id: 'build', slots: [{slot: 'test_first', invoke: 'skill', target: 'tdd'}, {slot: 'diagnose', invoke: 'builtin', target: 'step', on: 'gate_red'}]},
      {id: 'merge', slots: []},
    ]});
  });

  test('round-trips through the log line', () => {
    expect(parsePlanLine(planLine(storedPlan(plan)))).toEqual(storedPlan(plan));
  });

  test('an absent or unreadable line reads as no plan', () => {
    expect(parsePlanLine(null)).toBeNull();
    expect(parsePlanLine('not json')).toBeNull();
    expect(parsePlanLine('{"x":1}')).toBeNull();
  });

  test('formats stages with slots only; none reads as nothing', () => {
    expect(formatStoredPlan(storedPlan(plan))).toEqual(['build: test_first=skill tdd, diagnose=builtin']);
    expect(formatStoredPlan(undefined)).toEqual([]);
  });
});
