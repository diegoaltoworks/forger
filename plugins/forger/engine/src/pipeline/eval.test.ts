import {describe, expect, test} from 'bun:test';

import {evalPrompt, scoreCase, summarise, type EvalCase} from './eval';

const reviewCase: EvalCase = {
  name: 'off-by-one',
  input: 'x',
  facts: {diffPaths: ['src/list.ts']},
  properties: [
    {kind: 'finding', file: 'src/list.ts', line: 6, minSeverity: 'medium'},
    {kind: 'text', terms: ['slice']},
  ],
};

const found = {severity: 'high', file: 'src/list.ts', line: 6, summary: 'slice drops one item', disposition: 'fixed'};

describe('scoreCase', () => {
  const table: Array<[string, string | null, {passed: boolean; score: number; contractOk: boolean; met: boolean[]}]> = [
    ['a pass', JSON.stringify([found]), {passed: true, score: 1, contractOk: true, met: [true, true]}],
    ['a finding two lines off still counts', JSON.stringify([{...found, line: 8}]), {passed: true, score: 1, contractOk: true, met: [true, true]}],
    ['a contract failure: the file is not in the diff', JSON.stringify([{...found, file: 'src/other.ts'}]), {passed: false, score: 0, contractOk: false, met: [false, true]}],
    ['a missed property: a low finding elsewhere', JSON.stringify([{severity: 'low', file: 'src/list.ts', line: 1, summary: 'nit'}]), {passed: false, score: 0, contractOk: true, met: [false, false]}],
    ['one property missed of two', JSON.stringify([{...found, summary: 'wrong count'}]), {passed: false, score: 0.5, contractOk: true, met: [true, false]}],
    ['not JSON', 'oops', {passed: false, score: 0, contractOk: false, met: [false, false]}],
    ['no result', null, {passed: false, score: 0, contractOk: false, met: [false, false]}],
  ];
  for (const [name, raw, want] of table) {
    test(name, () => {
      const s = scoreCase('review', reviewCase, raw);
      expect({passed: s.passed, score: s.score, contractOk: s.contract.ok, met: s.properties.map(p => p.met)}).toEqual(want);
    });
  }

  test('the defect found only below the severity floor is missed', () => {
    const s = scoreCase('review', reviewCase, JSON.stringify([{...found, severity: 'low'}]));
    expect(s.properties[0]?.met).toBe(false);
  });

  test('at_most holds a clean diff to no findings', () => {
    const clean: EvalCase = {...reviewCase, properties: [{kind: 'at_most', count: 0, minSeverity: 'medium'}]};
    expect(scoreCase('review', clean, '[]').passed).toBe(true);
    expect(scoreCase('review', clean, JSON.stringify([found])).passed).toBe(false);
  });

  test('a slot with no contract scores zero', () => {
    expect(scoreCase('nonsense', reviewCase, '[]').contract.problems[0]).toContain('no contract');
  });

  test('a diagnosis is held to the gate command the case names', () => {
    const c: EvalCase = {name: 'd', input: 'x', facts: {gateCommand: 'bun test a.test.ts'}, properties: [{kind: 'text', terms: ['loop']}]};
    const good = {command: 'bun test a.test.ts', exit: 1, excerpt: 'fail', hypothesis: 'the loop skips one', result: 'confirmed'};
    expect(scoreCase('diagnose', c, JSON.stringify(good)).passed).toBe(true);
    expect(scoreCase('diagnose', c, JSON.stringify({...good, command: 'ls'})).contract.ok).toBe(false);
  });

  test('tests_written checks the criteria and test files of the case', () => {
    const c: EvalCase = {name: 't', input: 'x', facts: {diffPaths: ['src/a.test.ts'], criteria: [{id: 'c1', text: 'one'}]}, properties: []};
    expect(scoreCase('test_first', c, JSON.stringify([{criterion: 'c1', file: 'src/a.test.ts', test: 'works'}])).passed).toBe(true);
    expect(scoreCase('test_first', c, '[]').contract.problems[0]).toContain('c1');
  });
});

describe('summarise', () => {
  test('counts passes and averages scores', () => {
    const a = scoreCase('review', reviewCase, JSON.stringify([found]));
    const b = scoreCase('review', reviewCase, null);
    const s = summarise('review', 'builtin', [a, b]);
    expect({passed: s.passed, total: s.total, score: s.score}).toEqual({passed: 1, total: 2, score: 0.5});
  });
});

describe('evalPrompt', () => {
  test('names the skill and carries the input and the suffix', () => {
    const p = evalPrompt({preamble: 'PRE', skill: {file: '/s/SKILL.md'}, input: 'INPUT', suffix: 'SUFFIX'});
    expect(p).toContain('Read the file /s/SKILL.md');
    expect(p.indexOf('PRE')).toBeLessThan(p.indexOf('INPUT'));
    expect(p.endsWith('SUFFIX')).toBe(true);
    expect(evalPrompt({preamble: '', skill: {name: 'x:y'}, input: '', suffix: ''})).toContain('Invoke the skill x:y');
  });
});
