import {describe, expect, test} from 'bun:test';

import {
  INDEX_END,
  INDEX_START,
  checkCatalogue,
  parseCatalogue,
  parseStatus,
  rewriteEntry,
  ticketsOf,
  updateCatalogue,
  type TicketFacts,
} from './catalogue';
import {factFromIssue, parseFacts, trackerFacts} from './tracker';

const facts = (o: Record<number, number | 'closed' | 'open'>): TicketFacts =>
  new Map(
    Object.entries(o).map(([n, v]) => [Number(n), v === 'open' ? {closed: false, mergedPr: null} : v === 'closed' ? {closed: true, mergedPr: null} : {closed: true, mergedPr: v}])
  );

const doc = (body: string) => `# Failure catalogue\n\nIntro.\n\n${INDEX_START}\n${INDEX_END}\n\n## Group\n\n${body}`;

const OPEN = '### A hang\n\n**Status:** open, #205\n\n- **Seen:** x\n';
const FIXED = '### ~~A hang~~ - fixed by #260\n\n**Status:** fixed by #205\n\n- **Seen:** x\n';

describe('parseStatus', () => {
  test('reads the three forms', () => {
    expect(parseStatus('open, #205, #206')).toEqual({kind: 'open', tickets: [205, 206]});
    expect(parseStatus('open')).toEqual({kind: 'open', tickets: []});
    expect(parseStatus('fixed by #202, #203')).toEqual({kind: 'fixed', tickets: [202, 203]});
    expect(parseStatus('fixed (before tickets were tracked)')).toEqual({kind: 'untracked'});
  });
  test('rejects anything else', () => {
    expect(parseStatus('done')).toBeNull();
    expect(parseStatus('fixed by')).toBeNull();
  });
});

describe('parseCatalogue', () => {
  test('finds open, fixed and struck entries and one with no status', () => {
    const entries = parseCatalogue(doc(`${OPEN}\n${FIXED.replace('A hang', 'B')}\n### C\n\n- **Seen:** y\n`));
    expect(entries.map(e => [e.title, e.status?.kind ?? null])).toEqual([
      ['A hang', 'open'],
      ['B', 'fixed'],
      ['C', null],
    ]);
  });
});

describe('rewriteEntry', () => {
  const rewrite = (body: string, f: TicketFacts) => {
    const lines = body.split('\n');
    return rewriteEntry(lines, parseCatalogue(body)[0], f).join('\n');
  };
  test('a ticket closed by a merged PR strikes the heading and links the PR', () => {
    expect(rewrite(OPEN, facts({205: 260}))).toBe(FIXED);
  });
  test('a ticket closed as not planned leaves the entry open', () => {
    expect(rewrite(OPEN, facts({205: 'closed'}))).toBe(OPEN);
  });
  test('every ticket must be closed by a merged PR', () => {
    const two = OPEN.replace('#205', '#205, #206');
    expect(rewrite(two, facts({205: 260, 206: 'open'}))).toBe(two);
    expect(rewrite(two, facts({205: 260, 206: 261}))).toContain('### ~~A hang~~ - fixed by #260, #261');
  });
  test('a new open ticket reopens a fixed entry and restores the heading', () => {
    const reopened = FIXED.replace('fixed by #205', 'fixed by #205, #270');
    expect(rewrite(reopened, facts({205: 260, 270: 'open'}))).toBe(OPEN.replace('#205', '#205, #270'));
  });
  test('a ticket the tracker does not know leaves the entry alone', () => {
    expect(rewrite(OPEN, facts({}))).toBe(OPEN);
  });
  test('an entry fixed before tickets were tracked is struck without a PR', () => {
    const body = '### A hang\n\n**Status:** fixed (before tickets were tracked)\n';
    expect(rewrite(body, facts({}))).toBe('### ~~A hang~~ - fixed (before tickets were tracked)\n\n**Status:** fixed (before tickets were tracked)\n');
  });
});

describe('updateCatalogue', () => {
  test('writes the index, and a second run changes nothing', () => {
    const once = updateCatalogue(doc(OPEN), facts({205: 260}));
    expect(once).toContain('| A hang | fixed by #205 | [entry](#a-hang---fixed-by-260) |');
    expect(updateCatalogue(once, facts({205: 260}))).toBe(once);
  });
  test('leaves the prose around the index untouched', () => {
    const out = updateCatalogue(doc(OPEN), facts({205: 'open'}));
    expect(out.startsWith('# Failure catalogue\n\nIntro.\n\n')).toBe(true);
    expect(out).toContain('## Group\n\n### A hang');
  });
  test('the index lists every entry', () => {
    const text = doc(`${OPEN}\n${FIXED.replace('A hang', 'B')}`);
    const out = updateCatalogue(text, facts({205: 260}));
    const between = out.slice(out.indexOf(INDEX_START), out.indexOf(INDEX_END));
    expect(parseCatalogue(out).every(e => between.includes(`| ${e.title} |`))).toBe(true);
  });
});

describe('checkCatalogue', () => {
  const current = (body: string, f: TicketFacts) => updateCatalogue(doc(body), f);
  test('passes a catalogue that matches the tracker', () => {
    expect(checkCatalogue(current(OPEN, facts({205: 260})), facts({205: 260}))).toEqual([]);
  });
  test('fails an entry with no status', () => {
    expect(checkCatalogue(doc('### C\n\n- **Seen:** y\n'), null).map(p => p.rule)).toEqual(['catalogue-no-status']);
  });
  test('fails an entry whose status is stale against the tracker', () => {
    const text = current(OPEN, facts({205: 'open'}));
    expect(checkCatalogue(text, facts({205: 260})).map(p => p.rule)).toEqual(['catalogue-stale-status']);
  });
  test('fails a fixed entry whose ticket was reopened', () => {
    const text = current(OPEN, facts({205: 260}));
    expect(checkCatalogue(text, facts({205: 'open'})).map(p => p.rule)).toEqual(['catalogue-stale-status']);
  });
  test('fails an index that does not match the entries', () => {
    const text = current(OPEN, facts({205: 'open'})).replace('| A hang |', '| Something else |');
    expect(checkCatalogue(text, facts({205: 'open'})).map(p => p.rule)).toEqual(['catalogue-stale-index']);
  });
  test('without facts only the structure is checked', () => {
    expect(checkCatalogue(current(OPEN, facts({205: 'open'})), null)).toEqual([]);
  });
});

describe('ticketsOf', () => {
  test('lists the tickets once', () => {
    expect(ticketsOf(doc(`${OPEN}\n${OPEN.replace('A hang', 'B')}`))).toEqual([205]);
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
