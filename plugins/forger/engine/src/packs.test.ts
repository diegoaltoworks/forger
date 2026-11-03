import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {
  ManifestError,
  listOpinions,
  listPacks,
  loadPacks,
  mergeLock,
  parseLock,
  parseManifest,
  parsePackList,
  renderLock,
  selectPacks,
  sha256,
  type Lock,
  type Manifest,
} from './packs';

const good = {
  id: 'demo',
  version: '1.0.0',
  description: 'd',
  detect: [],
  files: [{source: 'files/a.md', target: '.claude/a.md'}],
  opinions: [
    {id: 'demo.one', rung: 'rule', summary: 's', check: null},
    {id: 'demo.two', rung: 'check', summary: 's', check: 'docs'},
  ],
  checks: ['docs'],
  slots: [],
};

function withChange(path: string[], value: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(good));
  let node = copy;
  for (const key of path.slice(0, -1)) node = node[key];
  if (value === undefined) delete node[path[path.length - 1]];
  else node[path[path.length - 1]] = value;
  return copy;
}

describe('parseManifest', () => {
  test('accepts a good manifest', () => {
    expect(parseManifest(good).opinions).toHaveLength(2);
  });

  const bad: Array<[string, unknown, string]> = [
    ['not an object', [], '(root)'],
    ['missing id', withChange(['id'], undefined), 'id'],
    ['uppercase id', withChange(['id'], 'Demo'), 'id'],
    ['missing version', withChange(['version'], undefined), 'version'],
    ['version not semver', withChange(['version'], '1.0'), 'version'],
    ['missing description', withChange(['description'], ''), 'description'],
    ['detect not a list', withChange(['detect'], 'x'), 'detect'],
    ['slots entry not a string', withChange(['slots'], [1]), 'slots[0]'],
    ['checks missing', withChange(['checks'], undefined), 'checks'],
    ['files not a list', withChange(['files'], {}), 'files'],
    ['file source escapes', withChange(['files', '0', 'source'], '../x'), 'files[0].source'],
    ['file target absolute', withChange(['files', '0', 'target'], '/etc/x'), 'files[0].target'],
    ['duplicate target', withChange(['files'], [{source: 'a', target: 't'}, {source: 'b', target: 't'}]), 'files'],
    ['opinions not a list', withChange(['opinions'], undefined), 'opinions'],
    ['opinion id outside the pack', withChange(['opinions', '0', 'id'], 'other.one'), 'opinions[0].id'],
    ['opinion rung unknown', withChange(['opinions', '0', 'rung'], 'wish'), 'opinions[0].rung'],
    ['opinion summary empty', withChange(['opinions', '0', 'summary'], ' '), 'opinions[0].summary'],
    ['opinion check unknown', withChange(['opinions', '1', 'check'], 'arch'), 'opinions[1].check'],
    ['check rung without a check', withChange(['opinions', '1', 'check'], null), 'opinions[1].check'],
    ['check on a non-check rung', withChange(['opinions', '0', 'check'], 'docs'), 'opinions[0].check'],
    ['duplicate opinion', withChange(['opinions', '1', 'id'], 'demo.one'), 'opinions'],
  ];
  for (const [name, raw, field] of bad) {
    test(`rejects ${name}, naming ${field}`, () => {
      try {
        parseManifest(raw);
        throw new Error('expected a ManifestError');
      } catch (e) {
        expect(e).toBeInstanceOf(ManifestError);
        expect((e as ManifestError).field).toBe(field);
        expect((e as Error).message).toContain(`"${field}"`);
      }
    });
  }
});

describe('loadPacks', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
  });
  function root(manifest: unknown, dirName = 'demo', withFile = true): string {
    const r = mkdtempSync(join(tmpdir(), 'forger-packs-'));
    dirs.push(r);
    mkdirSync(join(r, 'packs', dirName, 'files'), {recursive: true});
    if (withFile) writeFileSync(join(r, 'packs', dirName, 'files', 'a.md'), 'a');
    writeFileSync(join(r, 'packs', dirName, 'pack.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
    return r;
  }

  test('loads a pack directory', () => {
    expect(loadPacks(root(good)).map(p => p.manifest.id)).toEqual(['demo']);
  });
  test('a bad manifest is an error, not a skipped pack', () => {
    expect(() => loadPacks(root(withChange(['version'], 'x')))).toThrow('"version"');
  });
  test('invalid JSON is an error', () => {
    expect(() => loadPacks(root('{'))).toThrow('not valid JSON');
  });
  test('an id that differs from the directory is an error', () => {
    expect(() => loadPacks(root(good, 'other'))).toThrow('directory name');
  });
  test('a named file that does not exist is an error', () => {
    expect(() => loadPacks(root(good, 'demo', false))).toThrow('does not exist');
  });
  test('no packs directory means no packs', () => {
    expect(loadPacks(tmpdir() + '/definitely-not-here')).toEqual([]);
  });
});

describe('pack selection', () => {
  test('defaults to base and drops duplicates', () => {
    expect(parsePackList(undefined)).toEqual(['base']);
    expect(parsePackList(' a, b ,a')).toEqual(['a', 'b']);
  });
  test('reports unknown ids', () => {
    const available = [{manifest: parseManifest(good), dir: '/x'}];
    const r = selectPacks(available, ['demo', 'nope']);
    expect(r.packs).toHaveLength(1);
    expect(r.unknown).toEqual(['nope']);
  });
});

describe('lock', () => {
  const manifest: Manifest = parseManifest(good);
  const empty: Lock = {packs: []};

  test('records written files with their hash, sorted', () => {
    const lock = mergeLock(empty, [{manifest, written: [{path: 'b', sha256: 'h2'}, {path: 'a', sha256: 'h1'}]}]);
    expect(lock.packs[0].files.map(f => f.path)).toEqual(['a', 'b']);
  });
  test('keeps the recorded hash when a file is seen again', () => {
    const first = mergeLock(empty, [{manifest, written: [{path: 'a', sha256: 'old'}]}]);
    const second = mergeLock(first, [{manifest, written: [{path: 'a', sha256: 'new'}]}]);
    expect(second.packs[0].files).toEqual([{path: 'a', sha256: 'old'}]);
  });
  test('a second pack is appended after the first', () => {
    const other = {...manifest, id: 'other'};
    const lock = mergeLock(mergeLock(empty, [{manifest, written: []}]), [{manifest: other, written: []}]);
    expect(lock.packs.map(p => p.id)).toEqual(['demo', 'other']);
  });
  test('renders and parses back', () => {
    const lock = mergeLock(empty, [{manifest, written: [{path: 'a', sha256: sha256('x')}]}]);
    expect(parseLock(renderLock(lock))).toEqual(lock);
  });
  test('rejects a malformed lock', () => {
    expect(() => parseLock('{')).toThrow('not valid JSON');
    expect(() => parseLock('{}')).toThrow('lock.packs');
    expect(() => parseLock('{"packs":[{"id":"a","version":"1.0.0","files":[{"path":"p"}]}]}')).toThrow('sha256');
  });
});

describe('listings', () => {
  const available = [{manifest: parseManifest(good), dir: '/x'}];
  test('packs show what is installed', () => {
    expect(listPacks(available, {packs: []})[0].installed).toBe(false);
    const lock = {packs: [{id: 'demo', version: '0.9.0', files: []}]};
    expect(listPacks(available, lock)[0]).toMatchObject({installed: true, installedVersion: '0.9.0'});
  });
  test('opinions come only from installed packs, with pack, rung and check', () => {
    expect(listOpinions(available, {packs: []})).toEqual([]);
    const out = listOpinions(available, {packs: [{id: 'demo', version: '1.0.0', files: []}]});
    expect(out.map(o => [o.id, o.pack, o.rung, o.check])).toEqual([
      ['demo.one', 'demo', 'rule', null],
      ['demo.two', 'demo', 'check', 'docs'],
    ]);
  });
});
