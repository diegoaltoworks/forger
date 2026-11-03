import {describe, expect, test} from 'bun:test';

import type {Measures} from './measure';
import {buildReportMeasures, formatReportMeasures} from './report-measures';

const ticket = (cost_usd: number | null) => ({ticket: 't', runs: 1, seconds: 1, budget_cap_usd: null, cost_usd, ci_rounds: null});

const measures = {
  tickets: [ticket(1), ticket(3), ticket(null)],
  owner_interventions: {total: 3, by_event: {halted: 2, merged_red: 1}},
  change_rework: {window: 5, merged: 4, pairs: [], reworked: 1, rework_rate: 0.25, escaped_defects: [{issue: 9, pr: 2}], defective: 1, escaped_defect_rate: 0.25, pick_mismatches: []},
} as unknown as Measures;

describe('buildReportMeasures', () => {
  test('a fixed measures document gives the four numbers', () => {
    expect(buildReportMeasures(measures)).toEqual({
      cost_per_merged_ticket_usd: 2,
      cost_unknown_tickets: 1,
      merged_prs: 4,
      rework_rate: 0.25,
      escaped_defects: 1,
      owner_interventions: {total: 3, by_event: {halted: 2, merged_red: 1}},
    });
  });
  test('unknown stays unknown, never zero', () => {
    const r = buildReportMeasures({...measures, tickets: [ticket(null)], change_rework: null} as Measures);
    expect(r.cost_per_merged_ticket_usd).toBeNull();
    expect(r.rework_rate).toBeNull();
    expect(r.escaped_defects).toBeNull();
  });
});

describe('formatReportMeasures', () => {
  test('one line per measure', () => {
    expect(formatReportMeasures(buildReportMeasures(measures))).toEqual([
      '- cost per merged ticket: $2.00 (1 ticket(s) without a known cost)',
      '- rework rate: 25%',
      '- escaped defects: 1',
      '- owner interventions: 3 (halted 2, merged_red 1)',
    ]);
  });
  test('unknowns are said so', () => {
    const text = formatReportMeasures(buildReportMeasures({...measures, tickets: [], change_rework: null} as Measures)).join('\n');
    expect(text).toContain('cost per merged ticket: unknown');
    expect(text).toContain('rework rate: unknown');
    expect(text).toContain('escaped defects: unknown');
  });
});
