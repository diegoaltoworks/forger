import {describe, expect, test} from 'bun:test';

import {terminalEvent} from '../loop';
import {mergedInPeriod, ownerReviewPrs, proposedAdrs, recommendationFrom, reportPeriod, failedDeliveryItems, uncausedClearItems, waitingIssues} from './waiting';

describe('recommendationFrom', () => {
  test('the paragraph under a Recommendation heading', () => {
    expect(recommendationFrom('# T\n\nbody\n\n## Recommendation\n\nAccept it,\nthen build.\n\n## More\nx')).toBe('Accept it, then build');
  });
  test('a line that says I recommend, or starts Recommendation:', () => {
    expect(recommendationFrom('text\nI recommend splitting it.\n')).toBe('I recommend splitting it');
    expect(recommendationFrom('**Recommendation:** drop it')).toBe('drop it');
  });
  test('none when the text makes none', () => {
    expect(recommendationFrom('just a description')).toBeNull();
  });
});

describe('waitingIssues', () => {
  const issues = [
    {number: 82, title: 'b', labels: ['needs-triage'], body: ''},
    {number: 81, title: 'a', labels: ['ready-for-agent', 'needs-info'], body: 'Recommendation: split it'},
    {number: 5, title: 'fine', labels: ['ready-for-agent'], body: ''},
    {number: 9, title: 'c', labels: ['needs-human'], body: ''},
  ];
  test('every needs-info, needs-human and needs-triage issue, in number order, with its recommendation when it has one', () => {
    const w = waitingIssues(issues);
    expect(w.map(i => i.question)).toEqual(['#9 c is needs-human', '#81 a is needs-info', '#82 b is needs-triage']);
    expect(w[1].recommendation).toBe('split it');
    expect(w[0].recommendation).toContain('no recommendation');
  });
});

describe('a ticket set aside', () => {
  test('report lists a ticket set aside with its reason under waiting on you', () => {
    const w = waitingIssues([{number: 9, title: 'c', labels: ['needs-human'], body: ''}], new Map([[9, 'needs a key\nsecond line']]));
    expect(w).toHaveLength(1);
    expect(w[0].question).toBe('#9 c is needs-human');
    expect(w[0].because).toBe('the loop set it aside: needs a key');
  });
  test('a reason recorded for an issue that is not needs-human is not shown', () => {
    const w = waitingIssues([{number: 9, title: 'c', labels: ['needs-info'], body: ''}], new Map([[9, 'old']]));
    expect(w[0].because).not.toContain('set it aside');
  });
});

describe('proposedAdrs', () => {
  test('lists Proposed records only, with their recommendation', () => {
    const adrs = [
      {name: '0002-b.md', text: '# B\n\nStatus: Accepted\n\nx'},
      {name: '0001-a.md', text: '# A thing\n\nStatus: Proposed\n\nWhy it matters.\n\n## Recommendation\n\nAccept.'},
    ];
    const w = proposedAdrs(adrs);
    expect(w).toHaveLength(1);
    expect(w[0].question).toBe('ADR 0001-a is Proposed: A thing');
    expect(w[0].recommendation).toBe('Accept');
  });
});

describe('the period', () => {
  const prs = [
    {number: 3, title: 'c', mergedAt: '2026-11-03T12:00:00Z'},
    {number: 1, title: 'a', mergedAt: '2026-11-01T12:00:00Z'},
    {number: 2, title: 'b', mergedAt: '2026-11-02T12:00:00Z'},
  ];
  test('--since wins over the last report, which wins over none', () => {
    expect(reportPeriod('2026-11-02', '2026-11-03T00:00:00Z').source).toBe('flag');
    expect(reportPeriod(undefined, '2026-11-03T00:00:00Z')).toEqual({since: '2026-11-03T00:00:00.000Z', source: 'last_report'});
    expect(reportPeriod(undefined, null)).toEqual({since: null, source: 'none'});
  });
  test('a bad --since is an error', () => {
    expect(() => reportPeriod('yesterday-ish', null)).toThrow('--since');
  });
  test('Merged lists only the merges inside the period, oldest first', () => {
    expect(mergedInPeriod(prs, reportPeriod('2026-11-02T00:00:00Z', null))).toEqual(['#2 b', '#3 c']);
    expect(mergedInPeriod(prs, reportPeriod(undefined, null))).toEqual(['#1 a', '#2 b', '#3 c']);
  });
});

describe('uncausedClearItems', () => {
  test('the report lists an uncaused halt clear under waiting on you', () => {
    const items = uncausedClearItems([
      terminalEvent('halt_cleared', 1, null, 'boom', new Date(0), {cause: null, not_a_defect: null}),
      terminalEvent('halt_cleared', 2, null, 'fine', new Date(0), {cause: 5, not_a_defect: null}),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].question).toContain('boom');
  });
});

describe('ownerReviewPrs', () => {
  test('the report lists owner-review PRs under waiting on you', () => {
    const w = ownerReviewPrs([
      {number: 20, title: 'second', url: 'https://example.test/pull/20'},
      {number: 12, title: 'first', url: 'https://example.test/pull/12'},
    ]);
    expect(w.map(i => i.question)).toEqual([
      'PR #12 first is waiting for your review: https://example.test/pull/12',
      'PR #20 second is waiting for your review: https://example.test/pull/20',
    ]);
    expect(w[0].recommendation).toContain('merge it');
  });
});

describe('failedDeliveryItems', () => {
  test('lists a failed delivery until a later one passes', () => {
    const failed = {event: 'delivery_failed', at: 't', iteration: 1, ticket: 'issue-1', reason: 'PR #5: check failed'} as never;
    expect(failedDeliveryItems([failed])[0].question).toContain('PR #5');
    expect(failedDeliveryItems([failed, {event: 'delivered', at: 't', iteration: 2, ticket: 'issue-2', reason: 'PR #6: ok'} as never])).toEqual([]);
  });
});
