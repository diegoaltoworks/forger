import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join, resolve} from 'path';

import {sha256} from './packs';
import {GITIGNORE_LINES, mergeGitignore, renderConfig, runSetup, withDocsCheck} from './setup';

const PLUGIN_ROOT = resolve(import.meta.dir, '../..');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});
function emptyProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-setup-'));
  dirs.push(root);
  return root;
}

describe('withDocsCheck', () => {
  test('appends the docs check to the gates', () => {
    expect(withDocsCheck('npm test', 'forger check docs')).toBe('npm test && forger check docs');
  });
  test('does not add it twice', () => {
    expect(withDocsCheck('npm test && x check docs', 'y check docs')).toBe('npm test && x check docs');
  });
  test('empty gates become the docs check alone', () => {
    expect(withDocsCheck(' ', 'c check docs')).toBe('c check docs');
  });
});

describe('renderConfig skills', () => {
  const template = JSON.stringify({gates: 'g', skills: {}});
  test('a preset fills the skill slots', () => {
    const out = JSON.parse(renderConfig(template, {skills: {review: 'c:r'}}, 'c check docs'));
    expect(out.skills).toEqual({review: 'c:r'});
  });
  test('without a preset the slots stay empty', () => {
    expect(JSON.parse(renderConfig(template, {}, 'c check docs')).skills).toEqual({});
  });
});

describe('renderConfig', () => {
  const template = JSON.stringify({gates: 'old', base_branch: 'main', tracker: {kind: 'github', label: 'l'}});
  test('applies the answers and keeps the rest', () => {
    const out = JSON.parse(renderConfig(template, {gates: 'make test', baseBranch: 'dev', trackerKind: 'local'}, 'c check docs'));
    expect(out.gates).toBe('make test && c check docs');
    expect(out.base_branch).toBe('dev');
    expect(out.tracker).toEqual({kind: 'local', label: 'l'});
  });
  test('without answers the template defaults stay, plus the docs check', () => {
    const out = JSON.parse(renderConfig(template, {}, 'c check docs'));
    expect(out.gates).toBe('old && c check docs');
    expect(out.base_branch).toBe('main');
  });
});

describe('mergeGitignore', () => {
  test('adds only the missing lines, on their own line', () => {
    const r = mergeGitignore('node_modules\n.claude/HALT', ['.claude/HALT', '.claude/state.json']);
    expect(r.added).toEqual(['.claude/state.json']);
    expect(r.kept).toEqual(['.claude/HALT']);
    expect(r.text).toBe('node_modules\n.claude/HALT\n.claude/state.json\n');
  });
  test('leaves the text untouched when nothing is missing', () => {
    expect(mergeGitignore('a\n', ['a']).text).toBe('a\n');
  });
});

describe('runSetup', () => {
  test('writes every default file, then writes nothing on a second run', () => {
    const root = emptyProject();
    const first = runSetup(root, PLUGIN_ROOT, {gates: 'make test'});
    expect(first.files.every(f => f.action === 'written')).toBe(true);
    expect(first.gitignore.added).toEqual(GITIGNORE_LINES);
    for (const f of first.files) expect(existsSync(join(root, f.path))).toBe(true);

    const second = runSetup(root, PLUGIN_ROOT, {gates: 'other'});
    expect(second.files.every(f => f.action === 'kept')).toBe(true);
    expect(second.gitignore.added).toEqual([]);
  });

  test('never overwrites a file the project already has', () => {
    const root = emptyProject();
    runSetup(root, PLUGIN_ROOT, {});
    writeFileSync(join(root, '.claude/process.md'), 'mine');
    runSetup(root, PLUGIN_ROOT, {});
    expect(readFileSync(join(root, '.claude/process.md'), 'utf-8')).toBe('mine');
  });

  test('the installed process.md carries principle 0 and the default gotchas', () => {
    const root = emptyProject();
    runSetup(root, PLUGIN_ROOT, {});
    const process = readFileSync(join(root, '.claude/process.md'), 'utf-8');
    expect(process).toContain('Determinism first');
    expect(process).toContain('principle 0');
    expect(process).toContain('Comments say why');
  });

  test('the gates written into the config include the docs check', () => {
    const root = emptyProject();
    runSetup(root, PLUGIN_ROOT, {gates: 'make test'});
    const config = JSON.parse(readFileSync(join(root, '.claude/workloop.config.json'), 'utf-8'));
    expect(config.gates).toStartWith('make test && bun ');
    expect(config.gates).toEndWith('bin/work.ts check docs');
  });

  test('installs the ticket, PR, work order, report, retro and rule templates', () => {
    const root = emptyProject();
    runSetup(root, PLUGIN_ROOT, {});
    for (const n of ['ticket', 'pr', 'work-order', 'report', 'retro', 'rule']) {
      expect(existsSync(join(root, `.claude/templates/${n}.md`))).toBe(true);
    }
  });

  test('writes a lock whose hashes match the installed files, and leaves it alone on a second run', () => {
    const root = emptyProject();
    runSetup(root, PLUGIN_ROOT, {});
    const lockPath = join(root, '.claude/forger.lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
    expect(lock.packs.map((p: {id: string}) => p.id)).toEqual(['base']);
    expect(lock.packs[0].files.length).toBeGreaterThan(0);
    for (const f of lock.packs[0].files) {
      expect(sha256(readFileSync(join(root, f.path)))).toBe(f.sha256);
    }
    const before = readFileSync(lockPath, 'utf-8');
    const second = runSetup(root, PLUGIN_ROOT, {});
    expect(second.files.every(f => f.action === 'kept')).toBe(true);
    expect(readFileSync(lockPath, 'utf-8')).toBe(before);
  });

  test('a file the project already had is not recorded in the lock', () => {
    const root = emptyProject();
    mkdirSync(join(root, '.claude'));
    writeFileSync(join(root, '.claude/process.md'), 'mine');
    runSetup(root, PLUGIN_ROOT, {});
    const lock = JSON.parse(readFileSync(join(root, '.claude/forger.lock.json'), 'utf-8'));
    expect(lock.packs[0].files.map((f: {path: string}) => f.path)).not.toContain('.claude/process.md');
  });

  test('an unknown pack is an error and writes nothing', () => {
    const root = emptyProject();
    expect(() => runSetup(root, PLUGIN_ROOT, {packs: ['nope']})).toThrow('Unknown pack: nope');
    expect(existsSync(join(root, '.claude'))).toBe(false);
  });
});
