import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'fs';
import {join} from 'path';

import type {TerminalEvent} from '../loop';
import {computeMeasures, parseBudgets, ticketCost, type IterationRecord, type Measures} from './measure';
import {buildReportMeasures, formatReportMeasures} from './report-measures';
import {computeRework, parseDiffRanges, parseReplacedRanges, type MergedPr} from './rework';

const dir = join(import.meta.dir, 'fixtures/report');
const read = (f: string) => readFileSync(join(dir, f), 'utf-8');
const events = (f: string) =>
  read(f).trim().split('\n').map(l => JSON.parse(l) as TerminalEvent);

const iterations: IterationRecord[] = [1, 2, 3].map(n => ({iteration: n, ticket: `issue-${n + 9}`, elapsedSeconds: 60, cause: 'ok' as const, status: 'completed'}));

function pr(number: number, order: number, diffFile: string): MergedPr {
  const diff = read(diffFile);
  return {number, order, title: `feat: ticket (#${number})`, body: '', closes: number - 1, ranges: parseDiffRanges(diff), replaced: parseReplacedRanges(diff)};
}

const prs = [pr(100, 0, 'pr-10.diff'), pr(101, 1, 'pr-11.diff'), pr(102, 2, 'pr-12.diff'), {...pr(103, 3, 'pr-12.diff'), ranges: [], replaced: []}];

function measures(ev: string, costs: Record<string, number | null> = {}): Measures {
  return computeMeasures({
    iterations,
    budgets: parseBudgets(read('work.log')),
    events: events(ev),
    ciRuns: [],
    sessionCosts: costs,
    changes: {prs, issues: [], picks: [], window: 5},
    last: null,
  });
}

describe('the recorded run, worked by hand', () => {
  test('the session of each ticket comes from the work log, full or shortened', () => {
    expect(parseBudgets(read('work.log')).map(b => [b.ticket, b.sessionId])).toEqual([
      ['issue-10', '04655b0f'],
      ['issue-11', 'd0fdd598'],
      ['issue-12', 'fbe8ec05-1111-4222-8333-444455556666'],
    ]);
  });

  test('rework: only #100 is rewritten (#101 touches bookkeeping files and adds lines, #102 replaces #100 lines 3-4) so 1 of 4', () => {
    const r = computeRework({prs, issues: [], picks: [], window: 5});
    expect(r.pairs).toEqual([{original: 100, later: 102, reason: 'overlap', files: ['src/a.ts']}]);
    expect(r.reworked).toBe(1);
    expect(r.rework_rate).toBe(0.25);
  });

  test('interventions are unknown while the events file misses a run, and counted when it covers them all', () => {
    const partial = buildReportMeasures(measures('events.jsonl'));
    expect(partial.owner_interventions).toEqual({total: null, by_event: {}, unknown_reason: 'the events file has no record of 1 of 3 run(s) in the period'});
    expect(formatReportMeasures(partial).join('\n')).toContain('owner interventions: unknown (the events file has no record of 1 of 3 run(s)');
    const full = buildReportMeasures(measures('events-full.jsonl'));
    expect(full.owner_interventions).toEqual({total: 2, by_event: {merged_red: 1, halted: 1}, unknown_reason: null});
  });

  test('no transcripts: cost is unknown, never zero', () => {
    const r = buildReportMeasures(measures('events-full.jsonl'));
    expect(r.cost_per_merged_ticket_usd).toBeNull();
    expect(r.cost_unknown_tickets).toBe(3);
    expect(formatReportMeasures(r).join('\n')).toContain('cost per merged ticket: unknown (3 ticket(s) without a known cost)');
  });

  test('transcripts found by the shortened id give the mean over the tickets: (1.5 + 2.5 + 4) / 3', () => {
    const m = measures('events-full.jsonl', {'04655b0f': 1.5, d0fdd598: 2.5, 'fbe8ec05-1111-4222-8333-444455556666': 4});
    expect(buildReportMeasures(m).cost_per_merged_ticket_usd).toBeCloseTo(8 / 3);
  });

  test('a ticket with one unknown session has no cost', () => {
    expect(ticketCost(parseBudgets(read('work.log')).slice(0, 1), {})).toBeNull();
  });
});

describe('planned follow-ups', () => {
  test('a later PR that names the earlier one or its issue builds on it and is not rework', () => {
    const named = [prs[0], prs[1], {...prs[2], body: 'Builds on #99, which #100 left open'}];
    expect(computeRework({prs: named, issues: [], picks: [], window: 5}).pairs).toEqual([]);
    const byIssue = [prs[0], prs[1], {...prs[2], body: 'Needs issue #99 done first'}];
    expect(computeRework({prs: byIssue, issues: [], picks: [], window: 5}).reworked).toBe(0);
  });
});
