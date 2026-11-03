import {describe, expect, test} from 'bun:test';

import {type CommandRunner, verifyMerged} from './git';

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
