import {describe, expect, test} from 'bun:test';

import {buildReport, checksToRun, formatReport} from './checks';
import type {LoadedPack} from './packs';
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
    expect(r).toEqual({ok: true, waivers: [], staleWaivers: [], results: [{check: 'docs', opinions: [], status: 'passed', violations: [], waived: []}]});
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
