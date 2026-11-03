import {afterEach, describe, expect, test} from 'bun:test';
import {mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {runDocsCheck} from './docs-check';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-docs-'));
  dirs.push(root);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body);
  return root;
}

const lister = (names: string[]) => () => names.join('\n');

describe('runDocsCheck', () => {
  test('clean tree has no violations', () => {
    const root = repo({'a.md': 'plain text\n'});
    expect(runDocsCheck(root, lister(['a.md']))).toEqual([]);
  });

  test('scans only the files git lists', () => {
    const root = repo({'a.md': 'ok', 'untracked.md': 'bad \u2014'});
    expect(runDocsCheck(root, lister(['a.md']))).toEqual([]);
  });

  test('reads the denylist when present', () => {
    const root = repo({'a.md': 'about Acme', '.forger-denylist': 'acme\n'});
    const v = runDocsCheck(root, lister(['a.md']));
    expect(v.map(x => [x.line, x.rule])).toEqual([[1, 'denylist']]);
  });

  test('absent denylist is not an error', () => {
    const root = repo({'a.md': 'about Acme'});
    expect(runDocsCheck(root, lister(['a.md']))).toEqual([]);
  });

  test('skips lockfiles and binary files', () => {
    const root = repo({'bun.lock': 'x \u2014', 'img.bin': 'a\0\u2014'});
    expect(runDocsCheck(root, lister(['bun.lock', 'img.bin']))).toEqual([]);
  });
});
