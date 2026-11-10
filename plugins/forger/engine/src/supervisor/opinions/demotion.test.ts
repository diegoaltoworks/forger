import {describe, expect, test} from 'bun:test';

import {assessDemotion, demotionCandidates, draftDemotion, formatCandidates} from './demotion';
import type {OpinionFailures} from './failures';

const row = (o: Partial<OpinionFailures> = {}): OpinionFailures => ({opinion: 'a.one', runs_failed: 0, tickets_failed: 0, ended_fixed: 0, ended_waived: 0, ended_open: 0, never_failed: true, ...o});
const rungs = new Map([['a.one', 'check' as const], ['a.low', 'note' as const]]);

describe('demotion candidates', () => {
  test('an opinion that never failed over enough merged tickets is a candidate', () => {
    expect(demotionCandidates([row()], rungs, 20, 20)).toMatchObject([{opinion: 'a.one', reason: 'never-failed', proposal: 'template'}]);
  });

  test('an opinion waived more often than fixed is a candidate', () => {
    const r = row({never_failed: false, tickets_failed: 3, ended_waived: 2, ended_fixed: 1});
    expect(demotionCandidates([r], rungs, 2, 20)).toMatchObject([{reason: 'waived-more-than-fixed'}]);
  });

  test('an opinion with too few merged tickets behind it is not a candidate', () => {
    expect(demotionCandidates([row()], rungs, 19, 20)).toEqual([]);
    expect(formatCandidates([])).toBe('no opinion is a candidate for demotion');
  });

  test('an opinion on the lowest rung is proposed for removal', () => {
    expect(assessDemotion(row({opinion: 'a.low'}), 'note', 30, 20).proposal).toBe('removal');
  });

  test('the draft carries the opinion id, the numbers and the proposed rung', () => {
    const d = draftDemotion(assessDemotion(row(), 'check', 30, 20));
    expect(d.title).toContain('a.one');
    expect(d.body).toContain('a.one (rung check): failed on 0 ticket(s), 0 fixed, 0 waived, over 30 merged');
    expect(d.body).toContain('template');
    expect(draftDemotion(assessDemotion(row({opinion: 'a.low'}), 'note', 30, 20)).body).toContain('remove it');
  });
});
