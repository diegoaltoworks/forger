import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {CommandRunner} from '../../ports';
import {runStructureCheck, updateStructureBaseline, writeStructureBaseline} from './structure-check';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-structure-'));
  dirs.push(root);
  for (const [name, body] of Object.entries({'.forger/structure.json': '{"folder_limit": 2}', ...files})) {
    mkdirSync(join(root, name, '..'), {recursive: true});
    writeFileSync(join(root, name), body);
  }
  return root;
}

const runner = (paths: string[], opts: {base?: string; decisions?: string} = {}): CommandRunner => cmd => {
  if (cmd === 'git ls-files') return paths.join('\n');
  if (cmd.startsWith('git ls-files')) return '';
  if (cmd.startsWith('git merge-base')) return 'abc';
  if (cmd.startsWith('git show')) {
    if (opts.base === undefined) throw new Error('no such path');
    return opts.base;
  }
  if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'feat/issue-9';
  if (cmd.startsWith('gh issue view')) return `## Decisions\n${opts.decisions ?? 'none'}\n`;
  return '';
};

const SRC = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
const tree = () => repo(Object.fromEntries(SRC.map(p => [p, 'export const x = 1;'])));

describe('runStructureCheck', () => {
  test('without a baseline a folder over the limit fails', () => {
    const out = runStructureCheck(tree(), runner(SRC));
    expect(out.findings.map(f => f.rule)).toEqual(['structure.folder-size']);
  });

  test('--baseline writes the record, refuses a second time, and the recorded finding warns', () => {
    const root = tree();
    expect(writeStructureBaseline(root, runner(SRC))).toBe(1);
    expect(existsSync(join(root, '.forger/structure-baseline.json'))).toBe(true);
    expect(() => writeStructureBaseline(root, runner(SRC))).toThrow('already exists');
    const out = runStructureCheck(root, runner(SRC));
    expect(out.findings).toEqual([]);
    expect(out.warnings).toHaveLength(1);
  });

  test('--update drops entries that no longer hold', () => {
    const root = tree();
    writeStructureBaseline(root, runner(SRC));
    expect(updateStructureBaseline(root, runner(SRC.slice(0, 2)))).toBe(1);
    expect(JSON.parse(readFileSync(join(root, '.forger/structure-baseline.json'), 'utf-8')).entries).toEqual([]);
  });

  test('a baseline that gained entries since the merge-base fails unless the ticket\'s Decisions name it', () => {
    const root = tree();
    writeStructureBaseline(root, runner(SRC));
    const empty = JSON.stringify({entries: []});
    expect(runStructureCheck(root, runner(SRC, {base: empty})).findings.map(f => f.file)).toEqual(['.forger/structure-baseline.json']);
    expect(runStructureCheck(root, runner(SRC, {base: empty, decisions: '- .forger/structure-baseline.json may grow'})).findings).toEqual([]);
    expect(runStructureCheck(root, runner(SRC)).findings).toEqual([]);
  });

  test('a missing config is an error', () => {
    const root = tree();
    rmSync(join(root, '.forger/structure.json'));
    expect(() => runStructureCheck(root, runner(SRC))).toThrow('structure.json');
  });
});

describe('runStructureCheck gaps', () => {
  test('check structure reports a gap for its import rules on unread source files', () => {
    const paths = ['src/a.py', 'src/b.py', 'lib/c.ts'];
    const root = repo(Object.fromEntries(paths.map(p => [p, 'x'])));
    const out = runStructureCheck(root, runner(paths));
    expect(out.gaps).toEqual([{file: 'src/a.py', opinion: 'structure.import-rules', modality: 'SHOULD', detail: '2 files .py: imports in .py files are not read'}]);
    expect(out.findings).toEqual([]);
  });

  test('no gap when every source file is read', () => {
    expect(runStructureCheck(tree(), runner(SRC)).gaps).toEqual([]);
  });
});
