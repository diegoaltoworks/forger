import {unreadGaps, unreadSources} from './gaps';
import {describe, expect, test} from 'bun:test';

import {buildReport, checksToRun, formatReport} from './checks';
import type {LoadedPack} from '../packs';
import type {Finding, Waiver} from './waivers';

const pack = (id: string, checks: string[]): LoadedPack => ({
  dir: `/p/${id}`,
  manifest: {id, version: '1.0.0', description: 'd', detect: [], files: [], opinions: [], checks, slots: []},
});
const lock = (...ids: string[]) => ({packs: ids.map(id => ({id, version: '1.0.0', files: []}))});
const finding: Finding = {file: 'a.md', line: 3, rule: 'non-ascii', opinion: 'base.ascii-punctuation', detail: 'U+2014'};
const waiver: Waiver = {opinion: 'base.ascii-punctuation', path: 'a.md', reason: 'quoted', approved_by: 'owner'};

describe('checksToRun', () => {
  const available = [pack('base', ['docs']), pack('arch', ['arch', 'docs']), pack('idle', [])];
  const known = ['docs', 'arch'];
  test('follows the lock order and lists each check once', () => {
    expect(checksToRun(available, lock('arch', 'base'), known)).toEqual(['arch', 'docs']);
    expect(checksToRun(available, lock('base', 'arch'), known)).toEqual(['docs', 'arch']);
  });
  test('a pack with no checks adds none', () => expect(checksToRun(available, lock('idle'), known)).toEqual([]));
  test('only installed packs contribute', () => expect(checksToRun(available, lock('base'), known)).toEqual(['docs']));
  test('a locked pack that is unavailable is an error', () => expect(() => checksToRun(available, lock('gone'), known)).toThrow('gone'));
  test('a declared check forger cannot run is an error', () => expect(() => checksToRun(available, lock('arch'), ['docs'])).toThrow('arch'));
});

describe('buildReport', () => {
  test('no findings: passed and ok', () => {
    const r = buildReport([{check: 'docs', findings: []}], []);
    expect(r).toEqual({ok: true, gaps: [], waivers: [], staleWaivers: [], results: [{check: 'docs', opinions: [], status: 'passed', violations: [], waived: [], gaps: []}]});
  });
  test('an open violation fails the report', () => {
    const r = buildReport([{check: 'docs', findings: [finding]}], []);
    expect(r.ok).toBe(false);
    expect(r.results[0].status).toBe('failed');
  });
  test('a fully waived check is waived and the report is ok', () => {
    const r = buildReport([{check: 'docs', findings: [finding]}], [waiver]);
    expect(r.ok).toBe(true);
    expect(r.results[0].status).toBe('waived');
    expect(r.staleWaivers).toEqual([]);
  });
  test('waived plus open is still failed', () => {
    const r = buildReport([{check: 'docs', findings: [finding, {...finding, file: 'b.md'}]}], [waiver]);
    expect(r.results[0]).toMatchObject({status: 'failed'});
    expect(r.results[0].waived).toHaveLength(1);
  });
  test('a waiver matching nothing is reported stale without failing', () => {
    const r = buildReport([{check: 'docs', findings: []}], [waiver]);
    expect(r.ok).toBe(true);
    expect(r.staleWaivers).toEqual([waiver]);
  });
  test('each result names the installed opinions its check enforces', () => {
    const opinions = [{id: 'base.ascii', check: 'docs'}, {id: 'base.rule-only', check: null}, {id: 'arch.layers', check: 'arch'}, {id: 'base.personal', check: 'docs'}];
    const r = buildReport([{check: 'docs', findings: []}, {check: 'arch', findings: []}], [], opinions);
    expect(r.results.map(x => x.opinions)).toEqual([['base.ascii', 'base.personal'], ['arch.layers']]);
  });
  test('a waiver matching a finding in another check is not stale', () => {
    const r = buildReport([{check: 'docs', findings: []}, {check: 'arch', findings: [finding]}], [waiver]);
    expect(r.staleWaivers).toEqual([]);
  });
});

describe('formatReport', () => {
  test('lists violations, waivers and stale waivers', () => {
    const text = formatReport(buildReport([{check: 'docs', findings: [finding, {...finding, file: 'b.md'}]}], [waiver, {...waiver, path: 'zzz'}]));
    expect(text).toContain('docs: failed');
    expect(text).toContain('b.md:3: base.ascii-punctuation');
    expect(text).toContain('waived a.md:3');
    expect(text).toContain('approved by owner');
    expect(text).toContain('stale waiver: base.ascii-punctuation zzz');
  });
  test('says so when no pack declares a check', () => expect(formatReport(buildReport([], []))).toContain('no checks'));
});

describe('coverage gaps in the report', () => {
  const gap = (modality: 'MUST' | 'SHOULD' | 'MAY') => ({file: 'spec.toml', opinion: 'spec.x', modality, detail: 'no validator'});
  const status = (modality: 'MUST' | 'SHOULD' | 'MAY', waivers: Waiver[] = []) => buildReport([{check: 'spec', findings: [], gaps: [gap(modality)]}], waivers);

  test('a MUST gap fails the report and is listed apart from violations', () => {
    const r = status('MUST');
    expect(r.ok).toBe(false);
    expect(r.results[0].status).toBe('failed');
    expect(r.results[0].violations).toEqual([]);
    expect(r.gaps.map(g => g.severity)).toEqual(['fail']);
  });
  for (const m of ['SHOULD', 'MAY'] as const) {
    test(`a ${m} gap is unmeasured, not a pass and not a failure`, () => {
      const r = status(m);
      expect(r.ok).toBe(true);
      expect(r.results[0].status).toBe('unmeasured');
    });
  }
  test('a waived MUST gap no longer fails', () => {
    const r = status('MUST', [{opinion: 'spec.x', path: 'spec.toml', reason: 'r', approved_by: 'owner'}]);
    expect(r.ok).toBe(true);
    expect(r.results[0].status).toBe('waived');
  });
  test('a check without gaps reports an empty list', () => {
    expect(buildReport([{check: 'docs', findings: []}], []).results[0].gaps).toEqual([]);
  });
});

describe('buildReport with a spec gap', () => {
  test('a MUST gap fails; a SHOULD gap leaves the check unmeasured', () => {
    const must = {file: 'spec', opinion: 'spec.named-requirements-satisfied', modality: 'MUST' as const, detail: 'x'};
    expect(buildReport([{check: 'spec', findings: [], gaps: [must]}], []).results[0].status).toBe('failed');
    expect(buildReport([{check: 'spec', findings: [], gaps: [{...must, modality: 'SHOULD'}]}], []).results[0].status).toBe('unmeasured');
  });
});

describe('unread-language gaps in the report', () => {
  test('a result with only unread-language gaps is unmeasured, not passed', () => {
    const gaps = unreadGaps(unreadSources(['src/a.py'], () => false), 'architecture.dependency-rule');
    const r = buildReport([{check: 'arch', findings: [], gaps}], []);
    expect(r.ok).toBe(true);
    expect(r.results[0].status).toBe('unmeasured');
    expect(r.results[0].gaps.map(g => g.severity)).toEqual(['warn']);
  });
});
