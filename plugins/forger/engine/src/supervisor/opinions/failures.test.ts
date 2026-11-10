import {describe, expect, test} from 'bun:test';

import {computeOpinionFailures, formatOpinionFailures, type FailureRecord} from './failures';
import {computeNoneSections, formatNoneSections, sectionNames} from './none-sections';

const fail = (ticket: string, opinion: string): FailureRecord => ({ticket, opinion, failed: 1, waived: 0});
const waived = (ticket: string, opinion: string): FailureRecord => ({ticket, opinion, failed: 0, waived: 1});
const clean = (ticket: string): FailureRecord => ({ticket, failed: 0, waived: 0, clean: true});
const opinions = [{id: 'a.one'}, {id: 'a.two'}];

describe('computeOpinionFailures', () => {
  test('an opinion that failed on two tickets counts two tickets and every failed run', () => {
    const rows = computeOpinionFailures([fail('t1', 'a.one'), fail('t1', 'a.one'), fail('t2', 'a.one')], opinions, new Set());
    expect(rows[0]).toMatchObject({opinion: 'a.one', runs_failed: 3, tickets_failed: 2, ended_open: 2});
  });

  test('a ticket whose last record has no finding and which merged counts as fixed', () => {
    const rows = computeOpinionFailures([fail('t1', 'a.one'), clean('t1'), fail('t2', 'a.one'), clean('t2')], opinions, new Set(['t1']));
    expect(rows[0]).toMatchObject({ended_fixed: 1, ended_open: 1});
  });

  test('a ticket whose last record for the opinion is waived counts as waived', () => {
    const rows = computeOpinionFailures([fail('t1', 'a.one'), waived('t1', 'a.one'), fail('t1', 'a.two')], opinions, new Set(['t1']));
    expect(rows.find(r => r.opinion === 'a.one')).toMatchObject({ended_waived: 1, ended_fixed: 0, ended_open: 0});
  });

  test('an installed opinion with a check and no record is never_failed', () => {
    const rows = computeOpinionFailures([fail('t1', 'a.one')], opinions, new Set());
    expect(rows.map(r => [r.opinion, r.never_failed])).toEqual([['a.one', false], ['a.two', true]]);
    expect(rows[1]).toMatchObject({runs_failed: 0, tickets_failed: 0});
  });

  test('the most failures come first and the report lists the opinions that never failed last', () => {
    const rows = computeOpinionFailures([fail('t1', 'a.two'), fail('t2', 'a.two')], [...opinions, {id: 'a.three'}], new Set());
    expect(rows.map(r => r.opinion)).toEqual(['a.two', 'a.one', 'a.three']);
    expect(formatOpinionFailures(rows)).toBe('a.two: 2 run(s) failed on 2 ticket(s); 0 fixed, 0 waived, 2 open\nnever failed: a.one, a.three');
  });
});

describe('sections answered none', () => {
  const template = '<!-- note -->\n\n## Probe\n\n<!-- x\n## Hidden\n-->\n\nnone\n\n## Languages\n\ntext\n';
  test('the sections are the template headings outside comments', () => {
    expect(sectionNames(template)).toEqual(['Probe', 'Languages']);
  });

  test('a section answered none is counted per section', () => {
    const bodies = ['## Probe\n\nnone\n\n## Languages\n\nNone.\n', '## Probe\n\n- `test -f a` exits 0\n\n## Languages\n\nnone\n', '## Probe\n\nnone\n'];
    const rows = computeNoneSections(['Probe', 'Languages', 'Merge'], bodies);
    expect(rows).toEqual([{section: 'Probe', none: 2, of: 3}, {section: 'Languages', none: 2, of: 3}, {section: 'Merge', none: 0, of: 3}]);
    expect(formatNoneSections(rows)).toBe('sections answered none:\n  Probe: 2 of 3\n  Languages: 2 of 3\n  Merge: 0 of 3');
    expect(formatNoneSections([])).toBe('');
  });
});
