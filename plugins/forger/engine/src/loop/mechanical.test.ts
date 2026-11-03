import {describe, expect, test} from 'bun:test';

import type {SpecReport} from '../ports';
import {boundRequirement, mergeEntries, partitionCriteria} from './mechanical';

const report: SpecReport = {
  requirements: [
    {id: 'R-1', modality: 'MUST', state: 'satisfied'},
    {id: 'R-2', modality: 'MUST', state: 'unsatisfied'},
  ],
};
const criteria = [
  {id: 'c1', text: 'refuses a failed check [spec:R-1]'},
  {id: 'c2', text: 'names the head [spec:R-2]'},
  {id: 'c3', text: 'bound to nothing reported [spec:R-9]'},
  {id: 'c4', text: 'unbound judgement'},
];

describe('partitionCriteria', () => {
  const p = partitionCriteria(criteria, report);

  test('a bound, satisfied criterion is met with the spec check as evidence', () => {
    expect(p.mechanical).toEqual([{criterion: 'c1', verdict: 'met', evidence: [{kind: 'check', ref: 'spec:R-1'}]}]);
  });

  test('it is absent from what the verifier judges; every other criterion stays', () => {
    expect(p.remaining.map(c => c.id)).toEqual(['c2', 'c3', 'c4']);
  });

  test('with no spec report nothing is mechanical', () => {
    const none = partitionCriteria(criteria, null);
    expect(none.mechanical).toEqual([]);
    expect(none.remaining).toHaveLength(4);
  });

  test('a criterion without a binding reads as unbound', () => {
    expect(boundRequirement(criteria[3])).toBeNull();
    expect(boundRequirement(criteria[0])).toBe('R-1');
  });
});

describe('mergeEntries', () => {
  const p = partitionCriteria(criteria.slice(0, 2), report);
  test('orders by criterion and reduces over both sets', () => {
    const judged = [{criterion: 'c2', verdict: 'not_met' as const, evidence: [{kind: 'test' as const, ref: 't'}]}];
    const m = mergeEntries(criteria.slice(0, 2), p.mechanical, judged);
    expect(m.entries.map(e => e.criterion)).toEqual(['c1', 'c2']);
    expect(m.decision).toBe('block');
  });
  test('all criteria mechanical passes without a verifier', () => {
    const only = partitionCriteria([criteria[0]], report);
    expect(mergeEntries([criteria[0]], only.mechanical, []).decision).toBe('pass');
  });
});
