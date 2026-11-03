import {describe, expect, test} from 'bun:test';

import {parseArchConfig, type ArchConfig} from './arch';
import {MODULE_README_OPINION, PUBLIC_ENTRY_OPINION, moduleReadmeFindings, moduleOf, publicEntryFindings} from './modules';
import {applyWaivers} from '../waivers';

const config: ArchConfig = {layers: [], allow: {}, modules: {paths: ['src/*'], entry: 'index.ts'}};
const f = (path: string, text = '') => ({path, text});

describe('moduleOf', () => {
  test.each([
    ['src/a/x.ts', 'src/a'],
    ['src/a/deep/x.ts', 'src/a'],
    ['src/x.ts', null],
    ['docs/a/x.ts', null],
  ] as const)('%s', (file, expected) => {
    expect(moduleOf(file, [/^src\/[^/]*$/])).toBe(expected);
  });
});

describe('moduleReadmeFindings', () => {
  test('reports a module without a README', () => {
    const out = moduleReadmeFindings(['src/a/index.ts', 'src/b/index.ts', 'src/b/README.md'], config);
    expect(out.map(x => [x.file, x.opinion])).toEqual([['src/a/README.md', MODULE_README_OPINION]]);
  });

  test('passes when every module has one, and ignores files outside modules', () => {
    expect(moduleReadmeFindings(['src/a/README.md', 'src/a/x.ts', 'src/loose.ts', 'docs/x.md'], config)).toEqual([]);
  });

  test('does nothing without a modules declaration', () => {
    expect(moduleReadmeFindings(['src/a/x.ts'], {layers: [], allow: {}})).toEqual([]);
  });

  test('is waivable by opinion id and path', () => {
    const out = moduleReadmeFindings(['src/a/x.ts'], config);
    const waiver = {opinion: MODULE_README_OPINION, path: 'src/a/**', reason: 'r', approved_by: 'o'};
    expect(applyWaivers(out, [waiver]).violations).toEqual([]);
  });
});

describe('publicEntryFindings', () => {
  const tree = [f('src/a/index.ts'), f('src/a/inner.ts'), f('src/a/sub/deep.ts')];

  test('flags an import of an internal file from another module', () => {
    const out = publicEntryFindings([...tree, f('src/b/use.ts', "\nimport {x} from '../a/inner';")], config);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({file: 'src/b/use.ts', line: 2, opinion: PUBLIC_ENTRY_OPINION});
    expect(out[0].detail).toContain('src/a/index.ts');
  });

  test.each([
    ["import {x} from '../a'"],
    ["import {x} from '../a/index'"],
    ["import {x} from 'fs'"],
  ])('allows %s', src => {
    expect(publicEntryFindings([...tree, f('src/b/use.ts', src)], config)).toEqual([]);
  });

  test('allows imports within a module', () => {
    expect(publicEntryFindings([...tree, f('src/a/sub/x.ts', "import '../inner'; import './deep'")], config)).toEqual([]);
  });

  test('flags a file outside every module reaching in', () => {
    const out = publicEntryFindings([...tree, f('src/top.ts', "import '../src/a/sub/deep'")], config);
    expect(out).toHaveLength(1);
  });

  test('honours a custom entry file', () => {
    const cfg: ArchConfig = {...config, modules: {paths: ['src/*'], entry: 'mod.ts'}};
    const files = [f('src/a/mod.ts'), f('src/a/inner.ts'), f('src/b/u.ts', "import '../a/mod'; import '../a/inner'")];
    expect(publicEntryFindings(files, cfg)).toHaveLength(1);
  });

  test('is waivable by opinion id', () => {
    const out = publicEntryFindings([...tree, f('src/b/use.ts', "import '../a/inner'")], config);
    const waiver = {opinion: PUBLIC_ENTRY_OPINION, path: 'src/b/**', reason: 'r', approved_by: 'o'};
    expect(applyWaivers(out, [waiver]).violations).toEqual([]);
  });
});

describe('modules config', () => {
  const parse = (m: unknown) => parseArchConfig(JSON.stringify({layers: [], modules: m}));
  test('defaults the entry and trims a trailing slash', () => {
    expect(parse({paths: ['src/*/']}).modules).toEqual({paths: ['src/*'], entry: 'index.ts'});
  });
  test.each([
    [[], '"modules" must be an object'],
    [{paths: 'x'}, 'modules.paths'],
    [{paths: ['a'], entry: 'a/b.ts'}, 'modules.entry'],
  ])('rejects %j', (m, message) => {
    expect(() => parse(m)).toThrow(message);
  });
});
