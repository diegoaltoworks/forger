import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {dirname, join} from 'path';

import {detectPacks, formatSuggestions, matchRule, parseRule, readRepoFacts, type RepoFacts} from './detect';
import {loadPacks, type LoadedPack, type Lock} from './packs';

const facts = (f: Partial<RepoFacts>): RepoFacts => ({files: [], dirs: [], deps: [], ...f});

describe('parseRule', () => {
  const cases: Array<[string, unknown]> = [
    ['dep:react', {kind: 'dep', value: 'react'}],
    ['dep:@angular/core', {kind: 'dep', value: '@angular/core'}],
    ['file:schema.prisma', {kind: 'file', value: 'schema.prisma'}],
    ['dir:db/migrate', {kind: 'dir', value: 'db/migrate'}],
    ['react', null],
    ['dep:', null],
    ['tool:react', null],
    ['dir:/etc', null],
    ['file:../x', null],
    ['dep:two words', null],
  ];
  for (const [text, want] of cases) {
    test(`${text} parses to ${JSON.stringify(want)}`, () => expect(parseRule(text)).toEqual(want as never));
  }
});

describe('matchRule', () => {
  const cases: Array<[string, Partial<RepoFacts>, boolean]> = [
    ['file:index.html', {files: ['index.html']}, true],
    ['file:index.html', {files: ['web/index.html']}, true],
    ['file:index.html', {files: ['web/myindex.html']}, false],
    ['dir:migrations', {dirs: ['db/migrations']}, true],
    ['dir:migrations', {dirs: ['migrations']}, true],
    ['dir:migrations', {dirs: ['notmigrations']}, false],
    ['dir:migrations', {files: ['migrations']}, false],
    ['dep:react', {deps: ['react']}, true],
    ['dep:react', {deps: ['react-dom']}, false],
  ];
  for (const [text, f, want] of cases) {
    test(`${text} on ${JSON.stringify(f)} is ${want}`, () => expect(matchRule(parseRule(text)!, facts(f))).toBe(want));
  }
});

function pack(id: string, detect: string[]): LoadedPack {
  return {dir: '/x', manifest: {id, version: '1.0.0', description: id, detect, files: [], opinions: [], checks: [], slots: []}};
}

describe('detectPacks', () => {
  const available = [pack('a', ['dep:react', 'file:index.html']), pack('b', []), pack('c', ['dir:migrations'])];
  const none: Lock = {packs: []};

  test('names the rules that matched', () => {
    const out = detectPacks(available, none, facts({deps: ['react'], files: ['index.html']}));
    expect(out.map(s => [s.id, s.reasons])).toEqual([['a', ['dep:react', 'file:index.html']]]);
  });
  test('a pack with no rules is never suggested', () => {
    expect(detectPacks(available, none, facts({deps: ['react'], dirs: ['migrations']})).map(s => s.id)).toEqual(['a', 'c']);
  });
  test('an installed pack is not suggested again', () => {
    const lock: Lock = {packs: [{id: 'a', version: '1.0.0', files: []}]};
    expect(detectPacks(available, lock, facts({deps: ['react']}))).toEqual([]);
  });
  test('formats an empty answer in words', () => {
    expect(formatSuggestions([])).toBe('no packs suggested');
  });
});

describe('readRepoFacts and the shipped packs', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
  });
  function repo(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'detect-'));
    dirs.push(root);
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), {recursive: true});
      writeFileSync(join(root, path), body);
    }
    return root;
  }
  const pluginRoot = join(import.meta.dir, '..', '..', '..');
  const suggested = (root: string) => detectPacks(loadPacks(pluginRoot), {packs: []}, readRepoFacts(root)).map(s => s.id);

  test('skips dependency and tool folders', () => {
    const root = repo({'node_modules/x/index.html': '', '.git/HEAD': '', 'src/a.ts': ''});
    expect(readRepoFacts(root)).toEqual({files: ['src/a.ts'], dirs: ['src'], deps: []});
  });
  test('reads dependencies and dev dependencies', () => {
    const root = repo({'package.json': JSON.stringify({dependencies: {react: '1'}, devDependencies: {vitest: '1'}})});
    expect(readRepoFacts(root).deps).toEqual(['react', 'vitest']);
  });
  test('an unreadable package.json is an error, not an empty result', () => {
    expect(() => readRepoFacts(repo({'package.json': '{'}))).toThrow('package.json');
  });
  test('a UI app gets ui and testing', () => {
    const root = repo({'package.json': JSON.stringify({dependencies: {react: '1'}, devDependencies: {vitest: '1'}}), 'index.html': ''});
    expect(suggested(root)).toEqual(['testing', 'ui']);
  });
  test('a CLI gets testing only', () => {
    const root = repo({'package.json': JSON.stringify({bin: {tool: 'x.js'}, devDependencies: {jest: '1'}}), 'src/cli.ts': ''});
    expect(suggested(root)).toEqual(['testing']);
  });
  test('a service with migrations gets safety and testing', () => {
    const root = repo({'package.json': JSON.stringify({dependencies: {express: '1'}, devDependencies: {mocha: '1'}}), 'db/migrations/001.sql': ''});
    expect(suggested(root)).toEqual(['safety', 'testing']);
  });
  test('an empty repo gets nothing', () => {
    expect(suggested(repo({'README.md': ''}))).toEqual([]);
  });
});
