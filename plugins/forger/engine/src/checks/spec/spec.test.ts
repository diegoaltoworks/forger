import {describe, expect, test} from 'bun:test';

import type {RequirementModality, RequirementState, SpecProvider, SpecReport} from '../../ports';
import {absentSpecProvider, decideSpec, issueFromBranch, parseSatisfies, summarize} from './spec';
import {runSpecDecision} from './spec-check';

const rep = (...rs: Array<[string, RequirementModality, RequirementState]>): SpecReport => ({requirements: rs.map(([id, modality, state]) => ({id, modality, state}))});

describe('parseSatisfies', () => {
  test.each([
    ['Satisfies: A, B', ['A', 'B']],
    ['text\nsatisfies: A B\n- Satisfies: B,C', ['A', 'B', 'C']],
    ['no line here', []],
    ['Does not satisfy: A', []],
  ])('%j', (body, ids) => expect(parseSatisfies(body)).toEqual(ids));
});

describe('issueFromBranch', () => {
  test.each([['feat/issue-79\n', 79], ['main', null], ['feat/other', null]])('%j', (b, n) => expect(issueFromBranch(b)).toBe(n));
});

describe('decideSpec', () => {
  const head = rep(['a', 'MUST', 'satisfied'], ['b', 'MUST', 'unsatisfied'], ['c', 'SHOULD', 'unsatisfied'], ['d', 'MUST', 'unknown'], ['e', 'MAY', 'unsatisfied']);
  const rules = (d: ReturnType<typeof decideSpec>) => [...d.findings.map(f => `${f.opinion}:${f.rule}`), ...d.gaps.map(g => `${g.opinion}:${g.modality}`)];

  test('a satisfied named requirement is clean', () => {
    expect(decideSpec({named: ['a'], head, base: null}).findings).toEqual([]);
  });
  test('named-unsatisfied MUST is a violation', () => {
    const d = decideSpec({named: ['b'], head, base: head});
    expect(d.findings.map(f => f.rule)).toEqual(['named-unsatisfied']);
  });
  test('named-unknown: an unknown state and an ID absent from the spec are gaps, never passes', () => {
    const d = decideSpec({named: ['d', 'zzz'], head, base: head});
    expect(d.findings).toEqual([]);
    expect(d.gaps.map(g => [g.opinion, g.modality])).toEqual([['spec.named-requirements-satisfied', 'MUST'], ['spec.named-requirements-satisfied', 'MUST']]);
    expect(d.gaps[1].detail).toContain('zzz');
  });
  test('SHOULD and MAY unsatisfied are warnings and information, not violations', () => {
    const d = decideSpec({named: ['c', 'e'], head, base: head});
    expect(d.findings).toEqual([]);
    expect(d.gaps.map(g => g.modality)).toEqual(['SHOULD', 'MAY']);
  });
  test('MUST regression is flagged whether or not it is named', () => {
    const base = rep(['a', 'MUST', 'satisfied'], ['f', 'MUST', 'satisfied'], ['g', 'SHOULD', 'satisfied']);
    const now = rep(['a', 'MUST', 'unsatisfied'], ['g', 'SHOULD', 'unsatisfied']);
    const d = decideSpec({named: ['x'], head: now, base});
    expect(d.findings.filter(f => f.rule === 'must-regressed').map(f => f.detail)).toEqual([
      'a (MUST) was satisfied on the base and is unsatisfied now',
      'f (MUST) was satisfied on the base and is missing now',
    ]);
  });
  test('a MUST unsatisfied on the base is not a regression', () => {
    const d = decideSpec({named: [], head, base: rep(['b', 'MUST', 'unsatisfied'])});
    expect(d.findings.map(f => f.rule)).toEqual(['no-satisfies']);
  });
  test('no head report is a MUST gap, never a pass', () => {
    const d = decideSpec({named: ['a'], head: null, base: null});
    expect(d.findings).toEqual([]);
    expect(d.gaps).toHaveLength(1);
    expect(d.gaps[0]).toMatchObject({opinion: 'spec.named-requirements-satisfied', modality: 'MUST'});
    expect(d.summary).toBeNull();
  });
  test('an issue naming nothing, or unreadable, is flagged apart', () => {
    expect(rules(decideSpec({named: [], head, base: head}))).toEqual(['spec.ticket-names-requirements:no-satisfies']);
    expect(rules(decideSpec({named: null, head, base: head}))).toEqual(['spec.ticket-names-requirements:SHOULD']);
  });
  test('a missing base is a SHOULD gap on regressions', () => {
    expect(rules(decideSpec({named: ['a'], head, base: null}))).toEqual(['spec.must-never-regresses:SHOULD']);
  });
  test('summary counts states', () => {
    expect(summarize(head)).toEqual({total: 5, satisfied: 1, unsatisfied: 3, unknown: 1});
  });
});

describe('runSpecDecision', () => {
  const provider: SpecProvider = {report: side => (side === 'head' ? rep(['a', 'MUST', 'satisfied']) : rep(['a', 'MUST', 'satisfied']))};
  const gh = (branch: string, body: string) => (cmd: string) => (cmd.startsWith('git branch') ? branch : body);
  test('reads the issue named by the branch', () => {
    const d = runSpecDecision(gh('feat/issue-7', 'Satisfies: a'), provider);
    expect(d).toMatchObject({findings: [], gaps: []});
  });
  test('with no provider it reports a gap', () => {
    expect(runSpecDecision(gh('feat/issue-7', 'Satisfies: a'), absentSpecProvider).gaps.map(g => g.modality)).toContain('MUST');
  });
  test('an unreadable issue is a gap, not a throw', () => {
    const boom = (cmd: string): string => {
      if (cmd.startsWith('git branch')) return 'feat/issue-7';
      throw new Error('gh down');
    };
    expect(runSpecDecision(boom, provider).gaps[0].opinion).toBe('spec.ticket-names-requirements');
    expect(runSpecDecision(gh('main', ''), provider).gaps[0].opinion).toBe('spec.ticket-names-requirements');
  });
});
