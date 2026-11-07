import {describe, expect, test} from 'bun:test';

import {checkSequencing, parseSequencing} from './sequencing';

const body = (knock: string, extra = '') => `## Knock-on\n\n${knock}\n${extra}`;
const t = (number: number, b: string, native: number[] = []) => ({number, body: b, native});

describe('checkSequencing', () => {
  test('two open tickets sharing a Knock-on path with no link fail check ticket and name the path', () => {
    const problems = checkSequencing(t(1, body('`src/a.ts`')), [t(2, body('`src/a.ts`, `src/b.ts`'))]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('#1');
    expect(problems[0]).toContain('#2');
    expect(problems[0]).toContain('src/a.ts');
    expect(problems[0]).toContain('Sequencing');
  });

  test('two open tickets sharing a path where one blocks the other pass check ticket', () => {
    const a = body('`src/a.ts`');
    expect(checkSequencing(t(1, a, [2]), [t(2, a)])).toEqual([]);
    expect(checkSequencing(t(1, a), [t(2, a, [1])])).toEqual([]);
    expect(checkSequencing(t(1, a + '\n## Blocked by\n\n- #2\n'), [t(2, a)])).toEqual([]);
  });

  test('a Sequencing section naming the other ticket passes check ticket', () => {
    const a = body('`src/a.ts`', '\n## Sequencing\n\nAfter #2; this one re-measures.\n');
    expect(checkSequencing(t(1, a), [t(2, body('`src/a.ts`'))])).toEqual([]);
  });

  test('a ticket with no footprint is not compared', () => {
    expect(checkSequencing(t(1, '## What\n\nx'), [t(2, body('`src/a.ts`'))])).toEqual([]);
    expect(checkSequencing(t(1, body('`src/a.ts`')), [t(2, body('none'))])).toEqual([]);
  });

  test('a directory contains its files and a shared module counts', () => {
    expect(checkSequencing(t(1, body('`src/`')), [t(2, body('`src/a.ts`'))])).toHaveLength(1);
    expect(checkSequencing(t(1, body('the loop module')), [t(2, body('the loop module'))])).toHaveLength(1);
  });

  test('disjoint footprints pass', () => {
    expect(checkSequencing(t(1, body('`src/a.ts`')), [t(2, body('`src/b.ts`'))])).toEqual([]);
  });
});

describe('parseSequencing', () => {
  test('reads numbers under the heading only', () => {
    expect(parseSequencing('## Sequencing\n\n#3 first\n\n## Other\n\n#4')).toEqual([3]);
  });
});
