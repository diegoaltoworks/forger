import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {ARCH_OPINION} from './arch';
import {runArchCheck} from './arch-check';
import {loadPacks} from '../../packs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-arch-'));
  dirs.push(root);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), {recursive: true});
    writeFileSync(join(root, name), body);
  }
  return root;
}

const MAP = JSON.stringify({
  layers: [
    {name: 'core', paths: ['src/core/**']},
    {name: 'shell', paths: ['src/shell/**']},
  ],
  allow: {shell: ['core']},
});

describe('runArchCheck', () => {
  test('a fixture with one forbidden import reports exactly it', () => {
    const root = repo({
      '.claude/architecture.json': MAP,
      'src/core/decide.ts': "import {read} from '../shell/read';\nexport const d = read;",
      'src/core/other.ts': "import {d} from './decide';",
      'src/shell/read.ts': "import {d} from '../core/decide';\nexport const read = 1;",
    });
    const out = runArchCheck(root, () => 'src/core/decide.ts\nsrc/core/other.ts\nsrc/shell/read.ts');
    expect(out.map(f => [f.file, f.line, f.opinion])).toEqual([['src/core/decide.ts', 1, ARCH_OPINION]]);
  });

  test('only tracked files are read', () => {
    const root = repo({
      '.claude/architecture.json': MAP,
      'src/core/a.ts': "import '../shell/s';",
      'src/shell/s.ts': '',
    });
    expect(runArchCheck(root, () => 'src/shell/s.ts')).toEqual([]);
  });

  test('a missing layer map is an error, not a pass', () => {
    expect(() => runArchCheck(repo({}), () => '')).toThrow('not found');
  });

  test('a malformed layer map is an error', () => {
    expect(() => runArchCheck(repo({'.claude/architecture.json': '{}'}), () => '')).toThrow('layers');
  });
});

describe('the shipped architecture pack', () => {
  const pack = loadPacks(join(import.meta.dir, '..', '..', '..', '..')).find(p => p.manifest.id === 'architecture')!;

  test('declares the dependency rule as the opinion the check emits', () => {
    expect(pack.manifest.opinions.filter(o => o.check === 'arch').map(o => o.id)).toEqual([ARCH_OPINION]);
  });

  test('the starter layer map parses and passes', () => {
    const starter = readFileSync(join(pack.dir, 'files/architecture.json'), 'utf-8');
    expect(runArchCheck(repo({'.claude/architecture.json': starter}), () => '')).toEqual([]);
  });
});
