import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {LOCK_PATH, sha256} from './packs';
import {classify, runUpgrade, type Hashes} from './upgrade';

describe('classify', () => {
  const table: Array<[string, Hashes, string]> = [
    ['nothing moved', {lock: 'a', disk: 'a', upstream: 'a'}, 'unchanged'],
    ['untouched, pack changed', {lock: 'a', disk: 'a', upstream: 'b'}, 'take-upstream'],
    ['refined, pack unchanged', {lock: 'a', disk: 'c', upstream: 'a'}, 'keep'],
    ['both changed apart', {lock: 'a', disk: 'c', upstream: 'b'}, 'conflict'],
    ['both changed to the same', {lock: 'a', disk: 'b', upstream: 'b'}, 'converged'],
    ['new in the pack', {lock: null, disk: null, upstream: 'b'}, 'install'],
    ['new in the pack, project has a file', {lock: null, disk: 'x', upstream: 'b'}, 'project-owned'],
    ['removed from the pack', {lock: 'a', disk: 'a', upstream: null}, 'removed'],
    ['removed from the pack, refined', {lock: 'a', disk: 'c', upstream: null}, 'removed'],
    ['deleted by the project', {lock: 'a', disk: null, upstream: 'b'}, 'deleted'],
  ];
  for (const [name, h, want] of table) test(name, () => expect(classify(h)).toBe(want as never));

  test('only an untouched or absent file is ever written', () => {
    const hs = ['a', 'b', 'c', null];
    for (const lock of hs) for (const disk of hs) for (const upstream of hs) {
      const action = classify({lock, disk, upstream});
      if (action === 'take-upstream') expect(disk).toBe(lock);
      if (action === 'install') expect(disk).toBeNull();
    }
  });
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'forger-upgrade-'));
  dirs.push(d);
  return d;
}

const MANIFEST = (version: string, targets: string[]) => ({
  id: 'demo', version, description: 'd', detect: [], slots: [], checks: [], opinions: [],
  files: targets.map(t => ({source: `files/${t}`, target: `.forger/${t}`})),
});

function plugin(version: string, files: Record<string, string>): string {
  const root = tmp();
  const dir = join(root, 'packs/demo');
  mkdirSync(join(dir, 'files'), {recursive: true});
  writeFileSync(join(dir, 'pack.json'), JSON.stringify(MANIFEST(version, Object.keys(files))));
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, 'files', n), c);
  return root;
}

describe('runUpgrade on a fixture repo', () => {
  test('one file of each kind produces exactly the expected writes', () => {
    const project = tmp();
    const old = {'take.md': 'old', 'keep.md': 'old', 'both.md': 'old', 'gone.md': 'old'};
    mkdirSync(join(project, '.forger'), {recursive: true});
    for (const [n, c] of Object.entries(old)) writeFileSync(join(project, '.forger', n), c);
    writeFileSync(join(project, '.forger/keep.md'), 'mine');
    writeFileSync(join(project, '.forger/both.md'), 'mine');
    writeFileSync(
      join(project, LOCK_PATH),
      JSON.stringify({packs: [{id: 'demo', version: '1.0.0', files: Object.entries(old).map(([n, c]) => ({path: `.forger/${n}`, sha256: sha256(c)}))}]})
    );

    const upgraded = plugin('1.1.0', {'take.md': 'new', 'keep.md': 'old', 'both.md': 'theirs', 'fresh.md': 'fresh'});
    const result = runUpgrade(project, upgraded);

    const actions = Object.fromEntries(result.files.map(f => [f.path, f.action]));
    expect(actions).toEqual({
      '.forger/take.md': 'take-upstream',
      '.forger/keep.md': 'keep',
      '.forger/both.md': 'conflict',
      '.forger/fresh.md': 'install',
      '.forger/gone.md': 'removed',
    });
    const read = (n: string) => readFileSync(join(project, '.forger', n), 'utf-8');
    expect(read('take.md')).toBe('new');
    expect(read('keep.md')).toBe('mine');
    expect(read('both.md')).toBe('mine');
    expect(read('both.md.upstream')).toBe('theirs');
    expect(read('fresh.md')).toBe('fresh');
    expect(read('gone.md')).toBe('old');
    expect(existsSync(join(project, '.forger/keep.md.upstream'))).toBe(false);
    expect(result.review.sort()).toEqual(['.forger/both.md', '.forger/gone.md']);

    const lock = JSON.parse(readFileSync(join(project, LOCK_PATH), 'utf-8'));
    expect(lock.packs[0].version).toBe('1.1.0');
    const hashes = Object.fromEntries(lock.packs[0].files.map((f: {path: string; sha256: string}) => [f.path, f.sha256]));
    expect(hashes['.forger/take.md']).toBe(sha256('new'));
    expect(hashes['.forger/fresh.md']).toBe(sha256('fresh'));
    expect(hashes['.forger/keep.md']).toBe(sha256('old'));
    expect(hashes['.forger/both.md']).toBe(sha256('old'));
    expect(hashes['.forger/gone.md']).toBe(sha256('old'));
  });

  test('a second upgrade changes nothing', () => {
    const project = tmp();
    mkdirSync(join(project, '.forger'), {recursive: true});
    writeFileSync(join(project, '.forger/a.md'), 'old');
    writeFileSync(join(project, LOCK_PATH), JSON.stringify({packs: [{id: 'demo', version: '1.0.0', files: [{path: '.forger/a.md', sha256: sha256('old')}]}]}));
    const p = plugin('1.1.0', {'a.md': 'new'});
    runUpgrade(project, p);
    const lockAfter = readFileSync(join(project, LOCK_PATH), 'utf-8');
    const second = runUpgrade(project, p);
    expect(second.files.every(f => f.action === 'unchanged')).toBe(true);
    expect(readFileSync(join(project, LOCK_PATH), 'utf-8')).toBe(lockAfter);
  });

  test('a project without a lock is told to run setup', () => {
    expect(() => runUpgrade(tmp(), plugin('1.0.0', {'a.md': 'x'}))).toThrow('run setup');
  });
});

describe('runUpgrade gates', () => {
  test('an absolute check command in the config becomes the variable form, the rest kept', () => {
    const project = tmp();
    mkdirSync(join(project, '.forger'), {recursive: true});
    writeFileSync(join(project, LOCK_PATH), JSON.stringify({packs: []}));
    const config = join(project, '.forger/workloop.config.json');
    writeFileSync(config, '{ "gates": "make test && bun /opt/x/p/bin/work.ts check", "base_branch": "main" }\n');
    const result = runUpgrade(project, plugin('1.0.0', {}));
    expect(result.gates).toBe('rewritten');
    expect(readFileSync(config, 'utf-8')).toBe('{ "gates": "make test && bun \\"$FORGER_PLUGIN_ROOT/bin/work.ts\\" check", "base_branch": "main" }\n');
    expect(runUpgrade(project, plugin('1.0.0', {})).gates).toBeUndefined();
  });
});

describe('the base pack hooks policy', () => {
  test('setup --upgrade brings an unedited hooks policy to the default that lists leave-worktree', () => {
    const project = tmp();
    const old = JSON.stringify({rules: ['merge', 'push-base', 'status-write', 'state-edit'], deny: []}, null, 2) + '\n';
    mkdirSync(join(project, '.forger'), {recursive: true});
    writeFileSync(join(project, '.forger/hooks.json'), old);
    writeFileSync(join(project, LOCK_PATH), JSON.stringify({packs: [{id: 'base', version: '1.7.0', files: [{path: '.forger/hooks.json', sha256: sha256(old)}]}]}));
    const result = runUpgrade(project, join(import.meta.dir, '../../..'));
    expect(result.files).toContainEqual(expect.objectContaining({path: '.forger/hooks.json', action: 'take-upstream'}));
    expect(JSON.parse(readFileSync(join(project, '.forger/hooks.json'), 'utf-8')).rules).toContain('leave-worktree');
  });
});
