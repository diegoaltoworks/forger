import {afterEach, describe, expect, test} from 'bun:test';
import {execSync} from 'child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {dirname, join, resolve} from 'path';

import {runStructureCheck} from '../checks';
import {guardGlobsOf} from '../loop';
import {mergeConfig} from '../config';
import {parsePackList} from './packs';
import {runSetup, formatSetup} from './setup';
import {structureDefaults} from './structure-defaults';
import {formatUpgrade, runUpgrade} from './upgrade';

const PLUGIN_ROOT = resolve(import.meta.dir, '../../..');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function repo(files: Record<string, string> = {}): {root: string; run: (c: string) => string} {
  const root = mkdtempSync(join(tmpdir(), 'forger-structure-setup-'));
  dirs.push(root);
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), {recursive: true});
    writeFileSync(join(root, p), c);
  }
  const run = (c: string): string => execSync(c, {cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe']});
  run('git init -q -b main');
  run('git add -A && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init');
  return {root, run};
}

const read = (root: string, p: string): string => readFileSync(join(root, p), 'utf-8');
const lockIds = (root: string): string[] => JSON.parse(read(root, '.forger/forger.lock.json')).packs.map((p: {id: string}) => p.id);

describe('default packs', () => {
  test('setup with no packs named installs base and structure', () => {
    const {root} = repo();
    expect(parsePackList(undefined)).toEqual(['base', 'structure']);
    runSetup(root, PLUGIN_ROOT, {});
    expect(lockIds(root).sort()).toEqual(['base', 'structure']);
    expect(existsSync(join(root, '.forger/structure.json'))).toBe(true);
  });

  test('setup --upgrade on an install without structure adds it and says so', () => {
    const {root, run} = repo();
    runSetup(root, PLUGIN_ROOT, {packs: ['base']});
    expect(lockIds(root)).toEqual(['base']);
    const result = runUpgrade(root, PLUGIN_ROOT, run);
    expect(result.added).toEqual(['structure']);
    expect(lockIds(root).sort()).toEqual(['base', 'structure']);
    expect(existsSync(join(root, '.forger/structure.json'))).toBe(true);
    expect(formatUpgrade(result)).toContain('added          pack structure');
  });

  test('--upgrade leaves an install that has structure as it is', () => {
    const {root, run} = repo();
    runSetup(root, PLUGIN_ROOT, {run});
    writeFileSync(join(root, '.forger/structure.json'), '{"folder_limit": 3}\n');
    const result = runUpgrade(root, PLUGIN_ROOT, run);
    expect(result.added).toEqual([]);
    expect(read(root, '.forger/structure.json')).toBe('{"folder_limit": 3}\n');
  });
});

describe('structure baseline', () => {
  test('installing structure writes the baseline so check structure passes on the existing tree', () => {
    const crowded = Object.fromEntries(Array.from({length: 20}, (_, i) => [`src/m${i}.ts`, `export const v${i} = ${i};\n`]));
    const {root, run} = repo(crowded);
    const result = runSetup(root, PLUGIN_ROOT, {run});
    expect(result.structure?.baseline).toBeGreaterThan(0);
    expect(existsSync(join(root, '.forger/structure-baseline.json'))).toBe(true);
    expect(runStructureCheck(root, run).findings).toEqual([]);
    expect(formatSetup(result)).toContain('baseline recorded');
  });

  test('the default guards include the structure baseline', () => {
    const {root, run} = repo();
    runSetup(root, PLUGIN_ROOT, {run});
    expect(guardGlobsOf(root, mergeConfig({}))).toContain('.forger/structure-baseline.json');
  });
});

describe('defaults from repo facts', () => {
  test('setup on a repo with a next dependency adds the server-only guard', () => {
    const {root} = repo({'package.json': JSON.stringify({dependencies: {next: '1.0.0'}})});
    runSetup(root, PLUGIN_ROOT, {});
    expect(JSON.parse(read(root, '.forger/structure.json')).server_guards).toEqual([{files: '**/*.server.*', must_import: 'server-only'}]);
  });

  test('setup on a workspaces repo adds one boundary group per package', () => {
    const {root} = repo({
      'package.json': JSON.stringify({workspaces: ['packages/*']}),
      'packages/a/index.ts': 'export {};\n',
      'packages/b/index.ts': 'export {};\n',
    });
    const result = runSetup(root, PLUGIN_ROOT, {});
    const config = JSON.parse(read(root, '.forger/structure.json'));
    expect(config.boundaries).toEqual([
      {name: 'packages/a', paths: ['packages/a/**'], may_import: []},
      {name: 'packages/b', paths: ['packages/b/**'], may_import: []},
    ]);
    expect(config.frozen).toEqual([]);
    expect(formatSetup(result)).toContain('packages/a');
  });

  test('a pnpm workspace file names the packages', () => {
    const {root} = repo({'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n", 'apps/web/x.ts': 'export {};\n'});
    runSetup(root, PLUGIN_ROOT, {});
    expect(JSON.parse(read(root, '.forger/structure.json')).boundaries.map((b: {name: string}) => b.name)).toEqual(['apps/web']);
  });

  test('a repo with neither fact keeps the pack defaults', () => {
    const {root} = repo();
    runSetup(root, PLUGIN_ROOT, {});
    const config = JSON.parse(read(root, '.forger/structure.json'));
    expect(config.server_guards).toEqual([]);
    expect(config.boundaries).toEqual([]);
  });

  test('structureDefaults is pure over the facts', () => {
    expect(structureDefaults({deps: [], workspaces: []})).toEqual({server_guards: [], boundaries: []});
  });
});
