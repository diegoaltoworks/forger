import {describe, expect, test} from 'bun:test';

import {checkText, denylist, email, formatViolations, homePath, nonAscii, parseDenylist} from './docs-rules';

const EM_DASH = '\u2014';
const CURLY = '\u201C';

describe('nonAscii', () => {
  test('flags typographic punctuation with its code point', () => {
    expect(nonAscii(`a ${EM_DASH} b ${CURLY}c`)).toEqual(['U+2014', 'U+201C']);
  });
  test('passes plain ASCII', () => {
    expect(nonAscii('a - b "c" ... -> <=')).toEqual([]);
  });
});

describe('email', () => {
  test('flags an address', () => {
    expect(email('mail ' + 'someone' + '@' + 'example.com now')).toEqual(['someone@example.com']);
  });
  test('ignores scoped package names and bare at-signs', () => {
    expect(email('@types/bun and a @ b and @forger/engine')).toEqual([]);
  });
});

describe('homePath', () => {
  test('flags linux and mac home directories', () => {
    expect(homePath('see ' + '/ho' + 'me/' + 'x/y and ' + '/Us' + 'ers/' + 'z')).toEqual(['/home/x', '/Users/z']);
  });
  test('ignores home as an ordinary word', () => {
    expect(homePath('go home, or ~/work')).toEqual([]);
  });
});

describe('denylist', () => {
  test('parseDenylist drops blanks and comments', () => {
    expect(parseDenylist('Acme\n\n# note\n  widget  \n')).toEqual(['Acme', 'widget']);
  });
  test('matches case-insensitively and reports the term', () => {
    expect(denylist(['Acme'])('built for ACME corp')).toEqual(['Acme']);
  });
  test('no terms means no hits', () => {
    expect(denylist([])('anything')).toEqual([]);
  });
});

describe('checkText', () => {
  test('reports file, 1-based line and rule in line order', () => {
    const v = checkText('docs/a.md', `ok\nbad ${EM_DASH}\nAcme here`, ['acme']);
    expect(v.map(x => [x.file, x.line, x.rule])).toEqual([
      ['docs/a.md', 2, 'non-ascii'],
      ['docs/a.md', 3, 'denylist'],
    ]);
  });
  test('clean text has no violations', () => {
    expect(checkText('a.md', 'plain\ntext', [])).toEqual([]);
  });
  test('formats file:line and rule, or says clean', () => {
    expect(formatViolations(checkText('a.md', EM_DASH))).toBe('a.md:1: non-ascii: U+2014');
    expect(formatViolations([])).toBe('docs check: clean');
  });
});
