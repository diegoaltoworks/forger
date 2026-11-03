import {describe, expect, test} from 'bun:test';

import {applyWaivers, globToRegExp, parseWaivers, staleWaivers, type Finding, type Waiver} from './waivers';

const w = (over: Partial<Waiver> = {}): Waiver => ({opinion: 'base.ascii-punctuation', path: 'docs/**', reason: 'quoted', approved_by: 'owner', ...over});
const f = (over: Partial<Finding> = {}): Finding => ({file: 'docs/a.md', line: 1, rule: 'non-ascii', opinion: 'base.ascii-punctuation', detail: 'U+2014', ...over});

describe('globToRegExp', () => {
  const cases: Array<[string, string, boolean]> = [
    ['docs/**', 'docs/a.md', true],
    ['docs/**', 'docs/x/y/a.md', true],
    ['docs/**', 'other/a.md', false],
    ['docs/*.md', 'docs/a.md', true],
    ['docs/*.md', 'docs/x/a.md', false],
    ['**/*.md', 'a.md', true],
    ['**/*.md', 'x/y/a.md', true],
    ['a.md', 'aXmd', false],
    ['a?.md', 'ab.md', true],
    ['a?.md', 'a/.md', false],
  ];
  for (const [glob, path, want] of cases) {
    test(`${glob} ${want ? 'matches' : 'does not match'} ${path}`, () => expect(globToRegExp(glob).test(path)).toBe(want));
  }
});

describe('parseWaivers', () => {
  const ok = {opinion: 'a.b', path: 'x', reason: 'r', approved_by: 'o'};
  test('parses entries', () => expect(parseWaivers(JSON.stringify({waivers: [ok]}))).toEqual([ok]));
  test('an empty list is fine', () => expect(parseWaivers('{"waivers":[]}')).toEqual([]));
  for (const missing of ['opinion', 'path', 'reason', 'approved_by'] as const) {
    test(`missing ${missing} is an error`, () => {
      const {[missing]: _, ...rest} = ok;
      expect(() => parseWaivers(JSON.stringify({waivers: [rest]}))).toThrow(missing);
    });
  }
  test('a blank reason is an error', () => expect(() => parseWaivers(JSON.stringify({waivers: [{...ok, reason: '  '}]}))).toThrow('reason'));
  test('invalid JSON is an error', () => expect(() => parseWaivers('{')).toThrow('not valid JSON'));
  test('a bare list is an error', () => expect(() => parseWaivers('[]')).toThrow('"waivers" list'));
  test('a non-object entry is an error', () => expect(() => parseWaivers('{"waivers":[1]}')).toThrow('waivers[0]'));
});

describe('applyWaivers', () => {
  test('matches by opinion id and path', () => {
    const out = applyWaivers([f()], [w()]);
    expect(out.violations).toEqual([]);
    expect(out.waived).toEqual([{...f(), waiver: w()}]);
  });
  test('a different opinion does not match', () => {
    expect(applyWaivers([f({opinion: 'base.nothing-personal'})], [w()]).violations).toHaveLength(1);
  });
  test('a path outside the glob does not match', () => {
    expect(applyWaivers([f({file: 'src/a.ts'})], [w()]).violations).toHaveLength(1);
  });
  test('only the matching findings are waived', () => {
    const out = applyWaivers([f(), f({file: 'src/a.ts'})], [w()]);
    expect(out.waived).toHaveLength(1);
    expect(out.violations.map(v => v.file)).toEqual(['src/a.ts']);
  });
  test('no waivers leaves every finding open', () => {
    expect(applyWaivers([f()], []).violations).toHaveLength(1);
  });
});

describe('staleWaivers', () => {
  test('a waiver that matched is not stale', () => expect(staleWaivers([f()], [w()])).toEqual([]));
  test('a waiver that matches nothing is stale', () => expect(staleWaivers([f({file: 'src/a.ts'})], [w()])).toEqual([w()]));
  test('a waiver for an opinion with no findings is stale', () => expect(staleWaivers([], [w()])).toEqual([w()]));
});
