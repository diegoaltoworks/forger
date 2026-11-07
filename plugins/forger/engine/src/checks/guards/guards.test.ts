import {describe, expect, test} from 'bun:test';

import {addedLines, decisionsText, directionOf, loosened, skipsIn, withoutDecided, deletedFile} from './guards';

const SKIP = ['sk', 'ip'].join('');

describe('check guards rules', () => {
  test('lowering a minimum in a guard file fails check guards', () => {
    const f = loosened('.forger/coverage-baseline.json', '{"line_coverage": 80}', '{"line_coverage": 79.5}');
    expect(f).toHaveLength(1);
    expect(f[0].detail).toContain('from 80 to 79.5');
    expect(f[0].detail).toContain('decide');
  });

  test('raising a minimum in a guard file passes check guards', () => {
    expect(loosened('g.json', '{"min_coverage": 80}', '{"min_coverage": 85}')).toEqual([]);
    expect(loosened('g.json', '{"max_bytes": 100}', '{"max_bytes": 90}')).toEqual([]);
  });

  test('raising a maximum fails check guards', () => {
    expect(loosened('g.json', '{"maxBytes": 100}', '{"maxBytes": 120}')).toHaveLength(1);
  });

  test('a number with an unknown direction that changes in a guard file fails check guards', () => {
    expect(loosened('g.json', '{"threshold": 5}', '{"threshold": 6}')).toHaveLength(1);
    expect(loosened('g.json', '{"threshold": 5}', '{"threshold": 4}')).toHaveLength(1);
    expect(loosened('g.json', '{"threshold": 5}', '{"threshold": 5}')).toEqual([]);
  });

  test('a removed number loosens, a new one does not', () => {
    expect(loosened('g.json', '{"min_a": 1}', '{}')).toHaveLength(1);
    expect(loosened('g.json', '{}', '{"min_a": 1}')).toEqual([]);
  });

  test('repeated keys are compared one by one', () => {
    expect(loosened('g.json', '{"a": {"min": 5}, "b": {"min": 5}}', '{"a": {"min": 5}, "b": {"min": 4}}')).toHaveLength(1);
  });

  test('directions are read from the words of a key', () => {
    expect(directionOf('line_coverage')).toBe('minimum');
    expect(directionOf('maxBytes')).toBe('maximum');
    expect(directionOf('minMax')).toBe('unknown');
  });

  test('adding a skip to a test fails check guards', () => {
    const diff = ['@@ -1,0 +4,2 @@', `+  it.${SKIP}("x", () => {});`, '+  it("y", () => {});'].join('\n');
    const f = skipsIn('a.test.ts', addedLines(diff));
    expect(f.map(x => x.line)).toEqual([4]);
    expect(skipsIn('t.py', [{line: 1, text: `@pytest.mark.${SKIP}`}])).toHaveLength(1);
    expect(skipsIn('a.test.ts', [{line: 1, text: `x${'describe'}("a")`}, {line: 2, text: `test.${'to' + 'do'}("a")`}])).toHaveLength(2);
  });

  test('deleting a test file fails check guards', () => {
    expect(deletedFile('a.test.ts', 'test').detail).toContain('deleted');
  });

  test('a loosened guard named in the ticket\'s Decisions passes check guards', () => {
    const body = ['## What', 'x', '## Decisions', '- 2026-01-01, owner: lower .forger/coverage-baseline.json to 79', '## Other', 'y'].join('\n');
    const f = loosened('.forger/coverage-baseline.json', '{"line_coverage": 80}', '{"line_coverage": 79}');
    expect(withoutDecided(f, decisionsText(body))).toEqual([]);
    expect(withoutDecided(f, decisionsText('## What\n.forger/coverage-baseline.json'))).toHaveLength(1);
  });
});
