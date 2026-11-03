import {describe, expect, test} from 'bun:test';

import {classifyGaps, gapsFail, gapsOpen, severityFor, type Gap, type Modality} from './gaps';
import type {Waiver} from './waivers';

const gap = (modality: Modality, over: Partial<Gap> = {}): Gap => ({file: 'spec.toml', opinion: 'spec.x', modality, detail: 'validator missing', ...over});
const waiver: Waiver = {opinion: 'spec.x', path: 'spec.toml', reason: 'r', approved_by: 'owner'};

describe('severityFor', () => {
  const table: Array<[Modality, string]> = [['MUST', 'fail'], ['SHOULD', 'warn'], ['MAY', 'inform']];
  for (const [m, want] of table) test(`${m} -> ${want}`, () => expect(severityFor(m)).toBe(want as never));
});

describe('gap outcome', () => {
  const cases: Array<{name: string; modality: Modality; waivers: Waiver[]; fail: boolean; open: boolean}> = [
    {name: 'open MUST fails', modality: 'MUST', waivers: [], fail: true, open: true},
    {name: 'waived MUST does not fail', modality: 'MUST', waivers: [waiver], fail: false, open: false},
    {name: 'open SHOULD warns without failing', modality: 'SHOULD', waivers: [], fail: false, open: true},
    {name: 'open MAY informs without failing', modality: 'MAY', waivers: [], fail: false, open: true},
    {name: 'a waiver for another opinion does not apply', modality: 'MUST', waivers: [{...waiver, opinion: 'other'}], fail: true, open: true},
  ];
  for (const c of cases) {
    test(c.name, () => {
      const reported = classifyGaps([gap(c.modality)], c.waivers);
      expect(gapsFail(reported)).toBe(c.fail);
      expect(gapsOpen(reported)).toBe(c.open);
    });
  }

  test('no gaps is neither open nor failing', () => {
    expect(gapsFail([])).toBe(false);
    expect(gapsOpen([])).toBe(false);
  });

  test('each gap is waived on its own', () => {
    const reported = classifyGaps([gap('MUST'), gap('MUST', {file: 'other.toml'})], [waiver]);
    expect(reported.map(g => Boolean(g.waiver))).toEqual([true, false]);
  });
});
