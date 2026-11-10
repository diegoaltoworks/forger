import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join, resolve} from 'path';

import {runSetup} from '../setup';
import {hasSourceFile, installStarter, loadStarters} from './install';

const PLUGIN_ROOT = resolve(import.meta.dir, '../../../..');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-starter-'));
  dirs.push(root);
  return root;
}
const starter = () => loadStarters(PLUGIN_ROOT).find(s => s.name === 'bun-typescript')!;

describe('hasSourceFile', () => {
  test('an empty repository has none', () => {
    const root = project();
    writeFileSync(join(root, 'README.md'), 'x');
    expect(hasSourceFile(root)).toBe(false);
  });
  test('a source file in a folder counts', () => {
    const root = project();
    mkdirSync(join(root, 'lib'));
    writeFileSync(join(root, 'lib', 'a.py'), '');
    expect(hasSourceFile(root)).toBe(true);
  });
  test('vendored code does not count', () => {
    const root = project();
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'node_modules', 'a.js'), '');
    expect(hasSourceFile(root)).toBe(false);
  });
});

describe('setup with a starter', () => {
  test('setup in a repository with no source file copies the starter', () => {
    const root = project();
    const result = runSetup(root, PLUGIN_ROOT, {starter: starter()});
    for (const f of ['package.json', 'tsconfig.json', 'bun.lock', 'src/core/greet.ts', 'src/shell/main.ts', '.github/workflows/ci.yml']) {
      expect(existsSync(join(root, f))).toBe(true);
    }
    expect(result.starter).toBe('bun-typescript');
    expect(existsSync(join(root, 'starter.json'))).toBe(false);
    const config = JSON.parse(readFileSync(join(root, '.forger', 'workloop.config.json'), 'utf-8')) as {gates: string};
    expect(config.gates.startsWith('bun install --frozen-lockfile && bun run check && bun test --coverage --coverage-reporter=lcov && ')).toBe(true);
    for (const f of ['architecture.json', 'testing.json', 'journeys.json']) expect(existsSync(join(root, '.forger', f))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, '.forger', 'journeys.json'), 'utf-8')).journeys).toHaveLength(1);
  });
  test('setup in a repository with source files copies no starter', () => {
    const root = project();
    const result = runSetup(root, PLUGIN_ROOT, {});
    expect(result.starter).toBeUndefined();
    expect(existsSync(join(root, 'package.json'))).toBe(false);
    expect(existsSync(join(root, 'src'))).toBe(false);
  });
  test('setup never overwrites a file the starter also ships', () => {
    const root = project();
    writeFileSync(join(root, 'package.json'), '{"name":"mine"}');
    const entries = installStarter(root, PLUGIN_ROOT, starter());
    expect(entries.find(e => e.path === 'package.json')?.action).toBe('kept');
    expect(readFileSync(join(root, 'package.json'), 'utf-8')).toBe('{"name":"mine"}');
    expect(installStarter(root, PLUGIN_ROOT, starter()).every(e => e.action === 'kept')).toBe(true);
  });
});
