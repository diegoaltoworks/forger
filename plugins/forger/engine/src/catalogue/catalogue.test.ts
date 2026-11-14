import {describe, expect, test} from 'bun:test';

import {checkCatalogue, factsOnMerge, parseCatalogue, ticketsOf, updateCatalogue, type TicketFacts} from './catalogue';
import {branchPr, branchTicket, factFromIssue, parseFacts, trackerFacts} from './tracker';

const facts = (o: Record<number, number | 'closed' | 'open'>): TicketFacts =>
  new Map(
    Object.entries(o).map(([n, v]) => [Number(n), v === 'open' ? {closed: false, mergedPr: null} : v === 'closed' ? {closed: true, mergedPr: null} : {closed: true, mergedPr: v}])
  );

const BASE = 'https://github.com/o/r';
const I = (n: number) => `[#${n}](${BASE}/issues/${n})`;
const P = (n: number) => `[#${n}](${BASE}/pull/${n})`;

const doc = (open: string[], fixed: string[]) =>
  [
    '# Failure catalogue',
    '',
    'Intro.',
    '',
    '## Open',
    '',
    '| Failure | What it looks like | Issue |',
    '|---|---|---|',
    ...open,
    '',
    '## Fixed',
    '',
    '| Failure | What it looked like | Fixed by |',
    '|---|---|---|',
    ...fixed,
    '',
  ].join('\n');

const openRow = (title: string, n: number) => `| ${title} | hangs | ${I(n)} |`;
const fixedRow = (title: string, n: number, pr: number) => `| ${title} | hung | ${I(n)} - merged in ${P(pr)} |`;

describe('parseCatalogue', () => {
  test('reads both tables, the issues and the merged PRs', () => {
    const c = parseCatalogue(doc([openRow('A', 5)], [fixedRow('B', 6, 9), `| C | old | ${'before tickets were tracked'} |`]));
    expect(c.open.map(r => [r.title, r.tickets])).toEqual([['A', [5]]]);
    expect(c.fixed.map(r => [r.title, r.tickets, r.prs])).toEqual([
      ['B', [6], [9]],
      ['C', [], []],
    ]);
    expect(c.hasOpen && c.hasFixed).toBe(true);
  });
  test('finds entry sections', () => {
    expect(parseCatalogue(`${doc([], [])}\n### An entry\n`).entrySections).toHaveLength(1);
  });
});

describe('catalogue update', () => {
  test('moves a row to Fixed when its issues close by a merged PR', () => {
    const out = updateCatalogue(doc([openRow('A', 5)], []), facts({5: 9}));
    const c = parseCatalogue(out);
    expect(c.open).toEqual([]);
    expect(c.fixed.map(r => [r.title, r.tickets, r.prs])).toEqual([['A', [5], [9]]]);
    expect(out).toContain(`${I(5)} - merged in ${P(9)}`);
  });
  test('moves a row back to Open when a new open issue is added', () => {
    const reopened = doc([], [`| A | hung | ${I(5)}, ${I(12)} - merged in ${P(9)} |`]);
    const c = parseCatalogue(updateCatalogue(reopened, facts({5: 9, 12: 'open'})));
    expect(c.fixed).toEqual([]);
    expect(c.open.map(r => [r.title, r.tickets, r.prs])).toEqual([['A', [5, 12], []]]);
  });
  test('every issue must be closed by a merged PR', () => {
    const text = doc([`| A | hangs | ${I(5)}, ${I(6)} |`], []);
    expect(parseCatalogue(updateCatalogue(text, facts({5: 9, 6: 'closed'}))).open).toHaveLength(1);
    expect(parseCatalogue(updateCatalogue(text, facts({5: 9, 6: 10}))).fixed[0].prs).toEqual([9, 10]);
  });
  test('an issue the tracker does not know leaves the row alone', () => {
    const text = doc([openRow('A', 5)], []);
    expect(updateCatalogue(text, facts({}))).toBe(text);
  });
  test('a row fixed before tickets were tracked stays Fixed', () => {
    const text = doc([], ['| C | old | before tickets were tracked |']);
    expect(updateCatalogue(text, facts({}))).toBe(text);
  });
  test('a second run changes nothing and the prose around the tables survives', () => {
    const once = updateCatalogue(doc([openRow('A', 5)], []), facts({5: 9}));
    expect(updateCatalogue(once, facts({5: 9}))).toBe(once);
    expect(once.startsWith('# Failure catalogue\n\nIntro.\n\n## Open\n')).toBe(true);
  });
});

describe('checkCatalogue', () => {
  test('passes a catalogue that matches the tracker', () => {
    expect(checkCatalogue(doc([openRow('A', 5)], [fixedRow('B', 6, 9)]), facts({5: 'open', 6: 9}))).toEqual([]);
  });
  test('fails an Open row with no issue', () => {
    expect(checkCatalogue(doc(['| A | hangs | |'], []), null).map(p => p.rule)).toEqual(['catalogue-open-no-issue']);
  });
  test('fails an Open row whose issues are all closed', () => {
    expect(checkCatalogue(doc([openRow('A', 5)], []), facts({5: 'closed'})).map(p => p.rule)).toEqual(['catalogue-open-no-issue']);
  });
  test('fails an entry section', () => {
    expect(checkCatalogue(`${doc([], [])}\n### An entry\n`, null).map(p => p.rule)).toEqual(['catalogue-entry-section']);
  });
  test('fails a missing table', () => {
    expect(checkCatalogue('# Failure catalogue\n', null).map(p => p.rule)).toEqual(['catalogue-no-table', 'catalogue-no-table']);
  });
  test('fails a row the tracker has overtaken', () => {
    expect(checkCatalogue(doc([openRow('A', 5)], []), facts({5: 9})).map(p => p.rule)).toEqual(['catalogue-open-no-issue']);
    expect(checkCatalogue(doc([], [fixedRow('B', 6, 9)]), facts({6: 'open'})).map(p => p.rule)).toEqual(['catalogue-stale-status']);
  });
  test('fails a Fixed row that names no merged PR', () => {
    expect(checkCatalogue(doc([], [`| B | hung | ${I(6)} |`]), null).map(p => p.rule)).toEqual(['catalogue-fixed-no-merge']);
  });
  test('without facts only the structure is checked', () => {
    expect(checkCatalogue(doc([openRow('A', 5)], []), null)).toEqual([]);
  });
});

describe('a Fixed row on its own ticket branch', () => {
  const fixed = doc([], [fixedRow('B', 6, 9)]);
  test('passes when its only open issue is the branch ticket', () => {
    expect(checkCatalogue(fixed, facts({6: 'open'}), 6)).toEqual([]);
  });
  test('fails when its open issue is another ticket', () => {
    expect(checkCatalogue(fixed, facts({6: 'open'}), 7).map(p => p.rule)).toEqual(['catalogue-stale-status']);
  });
  test('the branch ticket counts closed by the PR no other ticket in the row was closed by', () => {
    const two = doc([], [`| B | hung | ${I(5)}, ${I(6)} - merged in ${P(8)}, ${P(9)} |`]);
    expect(factsOnMerge(two, facts({5: 8, 6: 'open'}), 6).get(6)).toEqual({closed: true, mergedPr: 9});
    expect(checkCatalogue(two, facts({5: 8, 6: 'open'}), 6)).toEqual([]);
  });
  test('leaves the facts alone off a ticket branch, for a closed ticket, or with no Fixed row', () => {
    const f = facts({6: 'open'});
    expect(factsOnMerge(fixed, f, null)).toBe(f);
    expect(factsOnMerge(doc([openRow('A', 6)], []), f, 6)).toBe(f);
    expect(factsOnMerge(fixed, facts({6: 9}), 6).get(6)).toEqual({closed: true, mergedPr: 9});
  });
});

describe('branchTicket', () => {
  test('reads the ticket of a feat/issue-<n> branch, else null', () => {
    expect(branchTicket(() => 'feat/issue-42\n')).toBe(42);
    expect(branchTicket(() => 'main')).toBeNull();
    const detached = (pr: string) => (cmd: string) => (cmd.startsWith('git branch') ? '' : cmd.startsWith('git rev-parse') ? 'abc\n' : pr);
    expect(branchTicket(detached('feat/issue-7\n'))).toBe(7);
    expect(branchTicket(detached(''))).toBeNull();
    expect(branchTicket(() => { throw new Error('not a repo'); })).toBeNull();
  });
});

describe('ticketsOf', () => {
  test('lists the issues once', () => {
    expect(ticketsOf(doc([openRow('A', 5)], [fixedRow('B', 5, 9)]))).toEqual([5]);
  });
});

describe('tracker facts', () => {
  const issue = (state: string, closer: object | null) => ({state, timelineItems: {nodes: closer ? [{closer}] : []}});
  test('merged PR, unmerged PR, hand close and open', () => {
    expect(factFromIssue(issue('CLOSED', {__typename: 'PullRequest', number: 9, merged: true}))).toEqual({closed: true, mergedPr: 9});
    expect(factFromIssue(issue('CLOSED', {__typename: 'PullRequest', number: 9, merged: false}))).toEqual({closed: true, mergedPr: null});
    expect(factFromIssue(issue('CLOSED', null))).toEqual({closed: true, mergedPr: null});
    expect(factFromIssue(issue('OPEN', null))).toEqual({closed: false, mergedPr: null});
  });
  test('parses the GraphQL answer by issue number', () => {
    const raw = JSON.stringify({data: {repository: {i5: issue('CLOSED', {__typename: 'PullRequest', number: 9, merged: true}), i6: null}}});
    expect([...parseFacts(raw)]).toEqual([[5, {closed: true, mergedPr: 9}]]);
  });
  test('a failing tracker gives null, and no tickets need no call', () => {
    expect(trackerFacts(() => { throw new Error('no gh'); }, [5])).toBeNull();
    expect(trackerFacts(() => { throw new Error('unused'); }, [])).toEqual(new Map());
  });
});

describe('an Open row on its own ticket branch', () => {
  const own = doc([openRow('A', 6)], []);
  test('an Open row whose only open issue is the branch\'s ticket fails the docs check once the branch has an open PR', () => {
    const found = checkCatalogue(own, facts({6: 'open'}), 6, 12);
    expect(found.map(p => p.rule)).toEqual(['catalogue-open-own-ticket']);
    expect(found[0].detail).toContain('catalogue --update');
    expect(found[0].detail).toContain('"A"');
  });
  test('an Open row whose only open issue is the branch\'s ticket passes the docs check before the branch has a PR', () => {
    expect(checkCatalogue(own, facts({6: 'open'}), 6, null)).toEqual([]);
  });
  test('an Open row that links another open issue passes the docs check on the branch', () => {
    const two = doc([`| A | hangs | ${I(6)}, ${I(7)} |`], []);
    expect(checkCatalogue(two, facts({6: 'open', 7: 'open'}), 6, 12)).toEqual([]);
  });
  test('without facts only the structure is checked', () => {
    expect(checkCatalogue(own, null, 6, 12)).toEqual([]);
  });
  test('catalogue --update on a ticket\'s branch moves the row that ticket closes to Fixed, naming the branch\'s open PR', () => {
    const f = factsOnMerge(own, facts({6: 'open'}), 6, 12);
    const out = updateCatalogue(own, f);
    expect(parseCatalogue(out).fixed.map(r => [r.tickets, r.prs])).toEqual([[[6], [12]]]);
    expect(parseCatalogue(out).open).toEqual([]);
    expect(checkCatalogue(out, facts({6: 'open'}), 6, 12)).toEqual([]);
  });
  test('the update leaves a row with another open issue in Open', () => {
    const two = doc([`| A | hangs | ${I(6)}, ${I(7)} |`], []);
    expect(updateCatalogue(two, factsOnMerge(two, facts({6: 'open', 7: 'open'}), 6, 12))).toBe(two);
  });
  test('a Fixed row whose open issue is another ticket still fails', () => {
    expect(checkCatalogue(doc([], [fixedRow('B', 6, 9)]), facts({6: 'open'}), 7, 12).map(p => p.rule)).toEqual(['catalogue-stale-status']);
  });
});

describe('branchPr', () => {
  const prs = JSON.stringify([{number: 12, headRefName: 'feat/issue-6', headRefOid: 'abc'}]);
  const run = (branch: string) => (cmd: string) => (cmd.startsWith('git branch') ? branch : cmd.startsWith('git rev-parse') ? 'abc\n' : prs);
  test('finds the open PR by branch name or, detached, by head commit', () => {
    expect(branchPr(run('feat/issue-6\n'))).toBe(12);
    expect(branchPr(run(''))).toBe(12);
    expect(branchPr(run('feat/issue-7\n'))).toBeNull();
  });
  test('is null when gh fails', () => {
    expect(branchPr(() => { throw new Error('no gh'); })).toBeNull();
  });
});
