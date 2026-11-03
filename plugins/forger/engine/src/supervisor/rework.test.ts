import {describe, expect, test} from 'bun:test';

import {computeRework, picksToPrs, parseDiffRanges, parseReplacedRanges, referencedNumbers, type MergedPr} from './rework';

function pr(number: number, order: number, extra: Partial<MergedPr> = {}): MergedPr {
  return {number, order, title: `feat: ${number}`, body: '', closes: null, ranges: [], ...extra};
}
const r = (file: string, start: number, end: number) => ({file, start, end});

describe('rework window', () => {
  const cases: {name: string; later: number; ranges: [string, number, number]; expected: number}[] = [
    {name: 'overlap one merge later', later: 1, ranges: ['a.ts', 15, 25], expected: 1},
    {name: 'overlap at the window edge', later: 5, ranges: ['a.ts', 10, 10], expected: 1},
    {name: 'overlap past the window', later: 6, ranges: ['a.ts', 10, 20], expected: 0},
    {name: 'same file, different lines', later: 1, ranges: ['a.ts', 21, 30], expected: 0},
    {name: 'same lines, different file', later: 1, ranges: ['b.ts', 10, 20], expected: 0},
  ];
  for (const c of cases) {
    test(c.name, () => {
      const prs = [pr(1, 0, {ranges: [r('a.ts', 10, 20)]}), pr(2, c.later, {ranges: [r(...c.ranges)]})];
      const m = computeRework({prs, issues: [], picks: []});
      expect(m.pairs.length).toBe(c.expected);
      expect(m.reworked).toBe(c.expected);
      expect(m.rework_rate).toBe(c.expected / 2);
    });
  }

  test('a custom window narrows the match', () => {
    const prs = [pr(1, 0, {ranges: [r('a.ts', 1, 5)]}), pr(2, 3, {ranges: [r('a.ts', 1, 5)]})];
    expect(computeRework({prs, issues: [], picks: [], window: 2}).pairs).toEqual([]);
    expect(computeRework({prs, issues: [], picks: []}).pairs[0].files).toEqual(['a.ts']);
  });

  test('an earlier merge is never reworked by a later one reading the other way round', () => {
    const prs = [pr(1, 1, {ranges: [r('a.ts', 1, 5)]}), pr(2, 0, {ranges: [r('a.ts', 1, 5)]})];
    expect(computeRework({prs, issues: [], picks: []}).pairs.map(p => [p.original, p.later])).toEqual([[2, 1]]);
  });
});

describe('reverts and defects', () => {
  const prs = [pr(10, 0), pr(11, 1), pr(12, 2, {title: 'Revert "feat: 10"', body: 'This reverts #10.'})];

  test('a revert names the PR it undoes', () => {
    const m = computeRework({prs, issues: [], picks: []});
    expect(m.pairs).toEqual([{original: 10, later: 12, reason: 'revert', files: []}]);
    expect(m.reworked).toBe(1);
  });

  test('a revert past the window is not rework', () => {
    const far = [pr(10, 0), pr(12, 9, {title: 'Revert x', body: '#10'})];
    expect(computeRework({prs: far, issues: [], picks: []}).pairs).toEqual([]);
  });

  test('a bug issue naming a merged PR is an escaped defect; other issues are not', () => {
    const issues = [
      {number: 20, labels: ['bug'], body: 'Broken by #11, found late.'},
      {number: 21, labels: ['enhancement'], body: 'Follow-up to #10.'},
      {number: 22, labels: ['bug'], body: 'Mentions #999 which never merged.'},
    ];
    const m = computeRework({prs, issues, picks: []});
    expect(m.escaped_defects).toEqual([{issue: 20, pr: 11}]);
    expect(m.defective).toBe(1);
    expect(m.escaped_defect_rate).toBeCloseTo(1 / 3);
  });
});

describe('pick versus built', () => {
  test('the pick event against the PR closed issue', () => {
    const prs = [pr(30, 0, {closes: 5}), pr(31, 1, {closes: 6}), pr(32, 2, {closes: null})];
    const picks = [
      {ticket: 'issue-5', pr: 30},
      {ticket: 'issue-7', pr: 31},
      {ticket: 'issue-8', pr: 32},
      {ticket: 'issue-9', pr: 99},
    ];
    expect(computeRework({prs, issues: [], picks}).pick_mismatches).toEqual([
      {pr: 31, picked: 'issue-7', built: 'issue-6'},
      {pr: 32, picked: 'issue-8', built: null},
    ]);
  });
});

test('no merged PRs gives zero rates', () => {
  const m = computeRework({prs: [], issues: [], picks: []});
  expect(m.rework_rate).toBe(0);
  expect(m.escaped_defect_rate).toBe(0);
});

test('referencedNumbers ignores anchors and repeats', () => {
  expect(referencedNumbers('see #3, #3 and a#4 and &#5 and #6.')).toEqual([3, 6]);
});

test('parseDiffRanges reads the added lines per file, not the context around them', () => {
  const diff = ['--- a/x.ts', '+++ b/x.ts', '@@ -1,3 +1,4 @@', ' ctx', '+a', '+b', ' ctx', ' ctx', '@@ -10,2 +12,2 @@', '-old', ' ctx', '+new', '--- a/gone.ts', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-a', '-b'].join('\n');
  expect(parseDiffRanges(diff)).toEqual([r('x.ts', 2, 3), r('x.ts', 13, 13)]);
});

test('parseReplacedRanges reads the deleted lines as numbered before the change', () => {
  const diff = ['--- a/x.ts', '+++ b/x.ts', '@@ -1,3 +1,4 @@', ' ctx', '+a', ' ctx', ' ctx', '@@ -10,2 +12,2 @@', '-old', ' ctx', '+new', '--- a/gone.ts', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-a', '-b'].join('\n');
  expect(parseReplacedRanges(diff)).toEqual([r('x.ts', 10, 10)]);
});

test('picksToPrs joins a pick to the PR its iteration built', () => {
  const prs = [pr(40, 0, {closes: 7}), pr(41, 1, {closes: 8})];
  const picked = [
    {iteration: 1, ticket: 'issue-6'},
    {iteration: 2, ticket: 'issue-8'},
    {iteration: 3, ticket: 'issue-9'},
  ];
  const built = [
    {iteration: 1, ticket: 'issue-7'},
    {iteration: 2, ticket: 'issue-8'},
  ];
  expect(picksToPrs(picked, built, prs)).toEqual([
    {ticket: 'issue-6', pr: 40},
    {ticket: 'issue-8', pr: 41},
  ]);
});
