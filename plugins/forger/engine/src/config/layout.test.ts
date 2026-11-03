import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {loadConfig} from './config';
import {chooseLayout, detectLayout, forgerPath, legacyWarning, rewriteReferences, toLogical, toPhysical} from './layout';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-layout-'));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), {recursive: true});
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe('chooseLayout', () => {
  const cases: Array<[string, {forger: boolean; legacyConfig: boolean}, string, boolean]> = [
    ['a fresh repo', {forger: false, legacyConfig: false}, '.forger', false],
    ['a legacy repo', {forger: false, legacyConfig: true}, '.claude', true],
    ['a migrated repo', {forger: true, legacyConfig: false}, '.forger', false],
    ['both folders: .forger wins', {forger: true, legacyConfig: true}, '.forger', false],
  ];
  for (const [name, has, dir, legacy] of cases) {
    test(name, () => expect(chooseLayout(has)).toEqual({dir, legacy}));
  }
});

describe('paths', () => {
  const legacy = {dir: '.claude', legacy: true};
  const current = {dir: '.forger', legacy: false};
  test('a logical path resolves to the layout folder', () => {
    expect(toPhysical(legacy, '.forger/state.json')).toBe('.claude/state.json');
    expect(toPhysical(current, '.forger/state.json')).toBe('.forger/state.json');
  });
  test('other paths are untouched', () => expect(toPhysical(legacy, 'docs/a.md')).toBe('docs/a.md'));
  test('a forger-owned legacy path becomes logical', () => {
    expect(toLogical('.claude/forger.lock.json')).toBe('.forger/forger.lock.json');
    expect(toLogical('.claude/opinions/ui.md')).toBe('.forger/opinions/ui.md');
  });
  test("a harness file stays where the harness keeps it", () => expect(toLogical('.claude/settings.local.json')).toBe('.claude/settings.local.json'));
  test('references inside a config are repointed, harness files are not', () => {
    expect(rewriteReferences('{"a": ".claude/backlog.json", "b": ".claude/settings.local.json"}')).toBe('{"a": ".forger/backlog.json", "b": ".claude/settings.local.json"}');
  });
});

describe('a legacy repo', () => {
  test('is detected, warned about once by name, and its config paths resolve to the legacy folder', () => {
    const root = project({'.claude/workloop.config.json': '{"gates": "make"}'});
    const layout = detectLayout(root);
    expect(layout.legacy).toBe(true);
    expect(legacyWarning(layout)).toContain('migrate');
    const config = loadConfig(root);
    expect(config.gates).toBe('make');
    expect(config.paths.state).toBe('.claude/state.json');
    expect(forgerPath(root, '.forger/forger.lock.json')).toBe(join(root, '.claude/forger.lock.json'));
  });
  test('a fresh repo resolves to .forger and prints no warning', () => {
    const root = project({'.forger/workloop.config.json': '{}'});
    expect(legacyWarning(detectLayout(root))).toBeNull();
    expect(loadConfig(root).paths.lock).toBe('.forger/runner.lock');
  });
});

describe('the folder name has one owner', () => {
  test('no engine source outside the layout module names the legacy folder with a slash', () => {
    const src = join(import.meta.dir, '..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !path.endsWith('config/layout.ts') && readFileSync(path, 'utf-8').includes('.claude/')) offenders.push(path);
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});
