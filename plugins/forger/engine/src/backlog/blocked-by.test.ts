import {describe, expect, test} from 'bun:test';

import {blockersToLink, dependencyAnomalies, parseBlockedBy} from './blocked-by';

describe('parseBlockedBy', () => {
  const cases: Array<[string, string | undefined, number[]]> = [
    ['no body', undefined, []],
    ['no section', '## What to build\n\nsee #5', []],
    ['none', '## Blocked by\n\nNone', []],
    ['one', '## What\n\nx\n\n## Blocked by\n\n- #81\n', [81]],
    ['several, once each', '## Blocked by\n\n- #106 (the base)\n- #108\n- #106 again\n', [106, 108]],
    ['text without a number', '## Blocked by\n\nthe design decision\n', []],
    ['stops at the next heading', '## Blocked by\n\n#1\n\n## Notes\n\n#2', [1]],
    ['a trailing colon and level', '### Blocked by:\n#7', [7]],
    ['crlf', '## Blocked by\r\n\r\n- #9\r\n', [9]],
  ];
  for (const [name, body, want] of cases) {
    test(name, () => expect(parseBlockedBy(body)).toEqual(want));
  }
});

describe('dependencyAnomalies', () => {
  const open = () => true;
  test('agreeing sets report nothing', () => {
    expect(dependencyAnomalies({number: 1, declared: [2], native: [2]}, open)).toEqual([]);
  });
  test('a body-only blocker is named', () => {
    expect(dependencyAnomalies({number: 82, declared: [81], native: []}, open)).toEqual([
      '#82 lists #81 under Blocked by but it is not linked as blocked-by',
    ]);
  });
  test('a native-only blocker is named', () => {
    expect(dependencyAnomalies({number: 3, declared: [], native: [2]}, open)).toEqual([
      '#3 is linked as blocked by #2 but its Blocked by section does not list it',
    ]);
  });
  test('a finished blocker is not worth reconciling', () => {
    expect(dependencyAnomalies({number: 3, declared: [2], native: []}, () => false)).toEqual([]);
  });
});

describe('blockersToLink', () => {
  test('skips linked ones and the issue itself', () => {
    expect(blockersToLink(5, [5, 1, 2], [2])).toEqual([1]);
  });
});
