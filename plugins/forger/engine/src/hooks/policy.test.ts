import {describe, expect, test} from 'bun:test';

import {DEFAULT_POLICY, DEFAULT_RULES, droppedRules, parseHookPolicy, renderHookPolicy} from './policy';
import {segments} from './shell';

describe('parseHookPolicy', () => {
  test('the rendered default parses back to itself, with every default rule', () => {
    expect(parseHookPolicy(renderHookPolicy())).toEqual(DEFAULT_POLICY);
    expect(droppedRules(DEFAULT_POLICY)).toEqual([]);
  });

  test('an absent rules list means every default', () => {
    expect(parseHookPolicy('{}').rules).toEqual([...DEFAULT_RULES]);
  });

  test('a list that leaves defaults out drops them', () => {
    expect(droppedRules(parseHookPolicy('{"rules": ["merge"]}'))).toEqual(['push-base', 'status-write', 'state-edit', 'leave-worktree']);
  });

  test.each([
    ['not json', 'is not valid JSON'],
    ['[]', 'must be an object'],
    ['{"rules": "merge"}', '"rules" must be a list'],
    ['{"rules": ["nope"]}', 'unknown rule "nope"'],
    ['{"deny": [{"id": "x", "pattern": "("}]}', 'needs a non-empty "message"'],
    ['{"deny": [{"id": "x", "pattern": "(", "message": "m"}]}', 'not a regular expression'],
    ['{"deny": [{"id": "merge", "pattern": "x", "message": "m"}]}', 'reuses the rule id merge'],
  ])('%s is refused: %s', (text, problem) => {
    expect(() => parseHookPolicy(text)).toThrow(problem);
  });
});

describe('segments', () => {
  test('splits on chains and resolves quotes', () => {
    expect(segments('a "b c" && d \'e f\' | g; h').map(s => s.words)).toEqual([['a', 'b c'], ['d', 'e f'], ['g'], ['h']]);
  });

  test('keeps redirect targets apart and drops fd duplication', () => {
    expect(segments('echo x > out 2>&1 >> more')).toEqual([{words: ['echo', 'x'], redirects: ['out', 'more']}]);
    expect(segments('cmd 2> err')).toEqual([{words: ['cmd'], redirects: ['err']}]);
  });

  test('strips wrappers and assignments, and reads nested shells', () => {
    expect(segments('A=1 env -u B C=2 sudo -u root gh pr view').map(s => s.words)).toEqual([['gh', 'pr', 'view']]);
    expect(segments('timeout 5 git push').map(s => s.words)).toEqual([['git', 'push']]);
    expect(segments('bash -c "a && b"').map(s => s.words)).toEqual([['a'], ['b']]);
  });

  test('a comment is not a command', () => {
    expect(segments('ls # gh pr merge 1').map(s => s.words)).toEqual([['ls']]);
  });
});
