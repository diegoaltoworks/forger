import {describe, expect, test} from 'bun:test';

import type {CommandRunner} from '../ports';
import {dirtyEntries, verifyMerged} from './merged';

/** A runner that answers each git command from a lookup, '' for anything else. */
function stubRunner(answers: Record<string, string>): CommandRunner {
  return (cmd: string) => answers[cmd] ?? '';
}

const BASE = 'main';
const clean: Record<string, string> = {
  'git branch --show-current': 'main',
  'git status --porcelain': '',
  'git rev-list --count origin/main..main': '0',
};

describe('verifyMerged', () => {
  test('null when on base branch, clean, and pushed', () => {
    expect(verifyMerged(stubRunner(clean), BASE)).toBeNull();
  });

  test('flags being on the wrong branch', () => {
    const r = stubRunner({...clean, 'git branch --show-current': 'feat/x'});
    expect(verifyMerged(r, BASE)).toBe('HEAD is on "feat/x", not main');
  });

  test('reports a detached HEAD', () => {
    const r = stubRunner({...clean, 'git branch --show-current': ''});
    expect(verifyMerged(r, BASE)).toBe('HEAD is on "detached", not main');
  });

  test('flags a dirty working tree', () => {
    const r = stubRunner({...clean, 'git status --porcelain': ' M src/x.ts'});
    expect(verifyMerged(r, BASE)).toBe('working tree is dirty');
  });

  test('flags unpushed commits', () => {
    const r = stubRunner({...clean, 'git rev-list --count origin/main..main': '2'});
    expect(verifyMerged(r, BASE)).toBe('main is 2 commit(s) unpushed');
  });

  test('honours a non-default base branch', () => {
    const answers = {
      'git branch --show-current': 'develop',
      'git status --porcelain': '',
      'git rev-list --count origin/develop..develop': '0',
    };
    expect(verifyMerged(stubRunner(answers), 'develop')).toBeNull();
  });
});

describe('dirtyEntries', () => {
  test('skips ignored files and directories, keeps the rest', () => {
    const porcelain = [' M .claude/state.json', '?? .claude/output/', ' M src/a.ts'].join('\n');
    expect(dirtyEntries(porcelain, ['.claude/state.json', '.claude/output'])).toEqual([
      ' M src/a.ts',
    ]);
  });

  test('reads a first line whose leading space the runner trimmed', () => {
    expect(dirtyEntries('M .claude/work.log', ['.claude/work.log'])).toEqual([]);
  });

  test('a rename is judged by its target', () => {
    expect(dirtyEntries('R  a.ts -> .claude/state.json', ['.claude/state.json'])).toEqual([]);
  });

  test('a sibling that merely shares a prefix is not ignored', () => {
    expect(dirtyEntries(' M .claude/state.json.bak', ['.claude/state.json'])).toHaveLength(1);
  });
});

describe('verifyMerged with ignored paths', () => {
  const answers = {
    'git branch --show-current': 'main',
    'git status --porcelain': ' M .claude/settings.local.json',
    'git rev-list --count origin/main..main': '0',
  };
  test('a tree dirty only in ignored files is clean', () => {
    expect(verifyMerged(stubRunner(answers), 'main', ['.claude/settings.local.json'])).toBeNull();
  });
  test('the same tree is dirty when nothing is ignored', () => {
    expect(verifyMerged(stubRunner(answers), 'main')).toBe('working tree is dirty');
  });
});
