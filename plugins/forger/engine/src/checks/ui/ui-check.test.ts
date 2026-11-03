import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {CommandRunner} from '../../ports';
import {runUiCheck} from './ui-check';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function repo(config: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-ui-'));
  dirs.push(root);
  mkdirSync(join(root, '.forger'));
  if (config !== null) writeFileSync(join(root, '.forger', 'ui.json'), config);
  return root;
}

const CONFIG = JSON.stringify({paths: ['src/**/*.tsx'], start: 's'});

function git(status: string, untracked = '', mergeBase = 'abc', tracked = ''): CommandRunner {
  return cmd => {
    if (cmd.startsWith('git merge-base')) return mergeBase;
    if (cmd.startsWith('git diff --name-status')) return status;
    if (cmd.startsWith('git ls-files --others')) return untracked;
    if (cmd === 'git ls-files') return tracked;
    return '';
  };
}

describe('runUiCheck', () => {
  test('a UI change with no screenshot fails', () => {
    expect(runUiCheck(repo(CONFIG), git('M\tsrc/App.tsx'))).toHaveLength(1);
  });

  test('a UI change with a committed screenshot passes', () => {
    expect(runUiCheck(repo(CONFIG), git('M\tsrc/App.tsx\nA\tdocs/screenshots/index-phone-light.png'))).toEqual([]);
  });

  test('an untracked screenshot counts as evidence', () => {
    expect(runUiCheck(repo(CONFIG), git('M\tsrc/App.tsx', 'docs/screenshots/index-phone-light.png'))).toEqual([]);
  });

  test('a branch with no UI change passes', () => {
    expect(runUiCheck(repo(CONFIG), git('M\tREADME.md'))).toEqual([]);
  });

  test('a missing config is an error, not a pass', () => {
    expect(() => runUiCheck(repo(null), git(''))).toThrow('not found');
  });

  test('an unresolvable base is an error, not a pass', () => {
    expect(() => runUiCheck(repo(CONFIG), git('', '', ''))).toThrow('merge-base');
  });

  test('a raw colour in a UI file fails ui.tokens even with screenshots', () => {
    const root = repo(CONFIG);
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'App.tsx'), 'const a = 1;\nconst c = "#ff00aa";\n');
    const findings = runUiCheck(root, git('M\tsrc/App.tsx\nA\tdocs/screenshots/a.png', '', 'abc', 'src/App.tsx'));
    expect(findings.map(f => [f.opinion, f.file, f.line])).toEqual([['ui.tokens', 'src/App.tsx', 2]]);
  });

  test('token files may hold literals; an unreadable listed file is skipped', () => {
    const config = JSON.stringify({paths: ['src/**/*.tsx', 'src/**/*.css'], tokens: ['src/tokens.css'], start: 's'});
    const root = repo(config);
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'tokens.css'), ':root { --brand: #123456; }');
    expect(runUiCheck(root, git('', '', 'abc', 'src/tokens.css\nsrc/gone.css'))).toEqual([]);
  });
});
