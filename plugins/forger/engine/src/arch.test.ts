import {describe, expect, test} from 'bun:test';

import {ArchConfigError, checkArch, layerOf, parseArchConfig, resolveImport, tsExtractor, type ArchConfig} from './arch';

const config: ArchConfig = {
  layers: [
    {name: 'core', paths: ['src/core/**']},
    {name: 'shell', paths: ['src/shell/**']},
  ],
  allow: {shell: ['core']},
};

describe('tsExtractor', () => {
  const kinds = (src: string) => tsExtractor.extract(src).map(r => [r.specifier, r.kind, r.line]);

  test.each([
    ["import {a} from './a';", [['./a', 'static', 1]]],
    ["import a from './a'", [['./a', 'static', 1]]],
    ["import * as a from './a'", [['./a', 'static', 1]]],
    ["import './side-effect'", [['./side-effect', 'static', 1]]],
    ["import a, {b} from './a'", [['./a', 'static', 1]]],
    ["import type {T} from './t'", [['./t', 'type', 1]]],
    ["import {type T} from './t'", [['./t', 'static', 1]]],
    ["export * from './a'", [['./a', 'reexport', 1]]],
    ["export * as ns from './a'", [['./a', 'reexport', 1]]],
    ["export {a, b} from './a'", [['./a', 'reexport', 1]]],
    ["export type {T} from './t'", [['./t', 'type', 1]]],
    ["const m = await import('./lazy')", [['./lazy', 'dynamic', 1]]],
    ["const m = require('./cjs')", [['./cjs', 'require', 1]]],
    ["import {\n  a,\n  b,\n} from './multi'", [['./multi', 'static', 1]]],
    ['import {a} from "./double"', [['./double', 'static', 1]]],
    ["export const x = 1;\nexport function f() {}", []],
  ] as const)('%s', (src, expected) => {
    expect(kinds(src)).toEqual(expected as unknown as Array<[string, string, number]>);
  });

  test('ignores imports in comments and keeps line numbers', () => {
    const src = "// import {a} from './no'\n/* import {b} from './no2'\n*/\nimport {c} from './yes';";
    expect(kinds(src)).toEqual([['./yes', 'static', 4]]);
  });

  test('an import-looking string is not an import', () => {
    expect(kinds("const s = \"import x from './no'\";")).toEqual([]);
  });
});

describe('resolveImport', () => {
  const files = new Set(['src/core/a.ts', 'src/core/dir/index.ts', 'src/shell/b.ts']);
  const exists = (p: string) => files.has(p);
  test.each([
    ['src/shell/b.ts', '../core/a', 'src/core/a.ts'],
    ['src/shell/b.ts', '../core/a.ts', 'src/core/a.ts'],
    ['src/shell/b.ts', '../core/dir', 'src/core/dir/index.ts'],
    ['src/shell/b.ts', 'fs', null],
    ['src/shell/b.ts', '../core/missing', null],
    ['src/shell/b.ts', '../../../outside', null],
  ] as const)('%s imports %s', (from, spec, expected) => {
    expect(resolveImport(from, spec, tsExtractor, exists)).toBe(expected);
  });
});

describe('layerOf', () => {
  test('first matching layer, null when none', () => {
    expect(layerOf('src/core/a.ts', config)).toBe('core');
    expect(layerOf('docs/x.ts', config)).toBeNull();
  });
});

describe('checkArch', () => {
  const f = (path: string, text: string) => ({path, text});

  test('allowed edges and same-layer imports pass', () => {
    const files = [f('src/core/a.ts', "import {b} from './b'"), f('src/core/b.ts', ''), f('src/shell/s.ts', "import {a} from '../core/a'")];
    expect(checkArch(files, config)).toEqual([]);
  });

  test('reports exactly the forbidden import, with its line and opinion', () => {
    const files = [
      f('src/core/a.ts', "import {b} from './b';\n\nimport {s} from '../shell/s';"),
      f('src/core/b.ts', ''),
      f('src/shell/s.ts', ''),
    ];
    const out = checkArch(files, config);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({file: 'src/core/a.ts', line: 3, rule: 'forbidden-import', opinion: 'architecture.dependency-rule'});
    expect(out[0].detail).toContain('core must not import shell');
  });

  test.each([
    ["import type {S} from '../shell/s'"],
    ["export * from '../shell/s'"],
    ["const m = import('../shell/s')"],
    ["const m = require('../shell/s')"],
  ])('catches %s', src => {
    const out = checkArch([f('src/core/a.ts', src), f('src/shell/s.ts', '')], config);
    expect(out).toHaveLength(1);
  });

  test('packages, builtins and files outside every layer are not constrained', () => {
    const files = [f('src/core/a.ts', "import fs from 'fs';\nimport x from '../../other/x'"), f('other/x.ts', '')];
    expect(checkArch(files, config)).toEqual([]);
  });

  test('findings come out in file order', () => {
    const files = [f('src/core/z.ts', "import '../shell/s'"), f('src/core/a.ts', "import '../shell/s'"), f('src/shell/s.ts', '')];
    expect(checkArch(files, config).map(x => x.file)).toEqual(['src/core/a.ts', 'src/core/z.ts']);
  });
});

describe('parseArchConfig', () => {
  const ok = JSON.stringify({layers: [{name: 'core', paths: ['a/**']}, {name: 'shell', paths: ['b/**']}], allow: {shell: ['core']}});
  test('parses a valid map', () => {
    expect(parseArchConfig(ok).allow).toEqual({shell: ['core']});
  });
  test('allow is optional', () => {
    expect(parseArchConfig(JSON.stringify({layers: []})).allow).toEqual({});
  });
  test.each([
    ['not json', 'is not valid JSON'],
    ['[]', 'must be an object'],
    ['{}', 'needs a "layers" list'],
    [JSON.stringify({layers: [{name: '', paths: ['a']}]}), 'non-empty "name"'],
    [JSON.stringify({layers: [{name: 'a', paths: 'x'}]}), 'list of non-empty strings'],
    [JSON.stringify({layers: [{name: 'a', paths: []}, {name: 'a', paths: []}]}), 'unique'],
    [JSON.stringify({layers: [{name: 'a', paths: []}], allow: {b: []}}), 'unknown layer b'],
    [JSON.stringify({layers: [{name: 'a', paths: []}], allow: {a: ['c']}}), 'unknown layer c'],
  ])('rejects %s', (text, message) => {
    expect(() => parseArchConfig(text)).toThrow(ArchConfigError);
    expect(() => parseArchConfig(text)).toThrow(message);
  });
});
