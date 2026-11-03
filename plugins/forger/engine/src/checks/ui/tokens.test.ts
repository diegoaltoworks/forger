import {describe, expect, test} from 'bun:test';

import {parseUiConfig} from '../../ui';
import {blankComments, checkTokens, findColourLiterals, tokenScanTargets} from './tokens';

describe('findColourLiterals', () => {
  const table: Array<[string, string, string[]]> = [
    ['a six digit hex', 'a { color: #ff0000; }', ['#ff0000']],
    ['a three digit hex', 'a { color: #fff; }', ['#fff']],
    ['four and eight digit hex with alpha', 'x: #ffff; y: #11223344;', ['#ffff', '#11223344']],
    ['rgb and rgba', 'c: rgb(0 0 0); d: RGBA(1,2,3,.5)', ['rgb(...)', 'RGBA(...)']],
    ['hsl and hsla', 'c: hsl(10 20% 30%); d: hsla(1,2%,3%,1)', ['hsl(...)', 'hsla(...)']],
    ['a token reference', 'a { color: var(--brand); }', []],
    ['a hex of an invalid length', 'a { color: #12345; }', []],
    ['a longer identifier that starts like a hex', '<a href="#abcdefg">', []],
    ['a hex in JSX', '<div style={{color: "#123abc"}} />', ['#123abc']],
    ['a line comment', '// was #fff\nconst a = 1;', []],
    ['a block comment', '/* #fff and rgb(0,0,0) */ a{}', []],
    ['an html comment', '<!-- #fff -->', []],
    ['a url is not a comment', 'const u = "http://x/#fff";', ['#fff']],
    ['no colours', 'const answer = 42;', []],
  ];
  for (const [name, source, expected] of table) test(name, () => expect(findColourLiterals(source).map(l => l.text)).toEqual(expected));

  test('reports the line, counted past comments', () => {
    expect(findColourLiterals('/* one\ntwo */\nb { color: #abc }')).toEqual([{line: 3, text: '#abc'}]);
  });

  test('blanking comments keeps the length and the newlines', () => {
    const src = 'a /* x\ny */ b // z\nc';
    expect(blankComments(src)).toHaveLength(src.length);
    expect(blankComments(src).split('\n')).toHaveLength(3);
  });
});

describe('tokenScanTargets', () => {
  const config = parseUiConfig(JSON.stringify({paths: ['src/**'], tokens: ['src/theme/**', 'src/tokens.css'], start: 's'}));
  test('keeps UI text files, drops token files, screenshots, binaries and non-UI paths', () => {
    expect(
      tokenScanTargets(['src/App.tsx', 'src/theme/colours.ts', 'src/tokens.css', 'src/logo.png', 'docs/screenshots/a.png', 'scripts/x.ts', 'src/a/b.css'], config)
    ).toEqual(['src/App.tsx', 'src/a/b.css']);
  });
});

describe('checkTokens', () => {
  test('one finding per literal, naming the opinion, file and line', () => {
    const findings = checkTokens([{path: 'src/A.tsx', content: 'ok\nconst c = "#fff"; const d = rgb(1,2,3);'}]);
    expect(findings.map(f => [f.file, f.line, f.opinion, f.rule])).toEqual([
      ['src/A.tsx', 2, 'ui.tokens', 'raw-colour-literal'],
      ['src/A.tsx', 2, 'ui.tokens', 'raw-colour-literal'],
    ]);
  });
  test('clean files produce nothing', () => expect(checkTokens([{path: 'a.css', content: 'a{color:var(--x)}'}])).toEqual([]));
});
