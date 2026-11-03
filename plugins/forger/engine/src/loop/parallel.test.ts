import {describe, expect, test} from 'bun:test';

import type {CapturingRunner, CommandResult} from '../ports';
import {conflictAfterAttempt, finishWorktree, folderMapFrom, inWorktree, stateDirFor} from './parallel';

const O = {ticket: 'tk-1', baseBranch: 'main', stateDir: '/r/.forger'};
const ok = (stdout = ''): CommandResult => ({stdout, stderr: '', exitCode: 0});

function fake(replies: Record<string, CommandResult> = {}): {run: CapturingRunner; calls: string[]} {
  const calls: string[] = [];
  return {
    calls,
    run: cmd => {
      calls.push(cmd);
      const key = Object.keys(replies).find(k => cmd.includes(k));
      return key ? replies[key] : ok();
    },
  };
}

describe('inWorktree', () => {
  test('points git calls at the worktree and leaves other commands alone', () => {
    const seen: string[] = [];
    const run = inWorktree(c => (seen.push(c), ''), "/r/it's");
    run('git branch --show-current');
    run('gh pr view feat/x');
    expect(seen).toEqual([`git -C '/r/it'\\''s' branch --show-current`, 'gh pr view feat/x']);
  });
});

describe('stateDirFor', () => {
  test('is the configured state directory in the main checkout', () => {
    expect(stateDirFor('/r', '.forger/state.json', 'tk-1')).toBe('/r/.forger');
  });
  test('is the directory the worktrees live under when run inside the ticket worktree', () => {
    expect(stateDirFor('/r/.forger/worktrees/tk-1', '.forger/state.json', 'tk-1')).toBe('/r/.forger');
  });
  test('a worktree of another ticket is not mistaken for this one', () => {
    expect(stateDirFor('/r/.forger/worktrees/tk-2', '.forger/state.json', 'tk-1')).toBe('/r/.forger/worktrees/tk-2/.forger');
  });
});

describe('folderMapFrom', () => {
  test('reads module roots from the architecture map and lists the folders under them', () => {
    const map = folderMapFrom({modules: {paths: ['src/*']}}, root => (root === 'src' ? ['loop', 'checks'] : []));
    expect(map).toEqual({roots: ['src'], folders: ['src/loop', 'src/checks']});
  });
  test('no architecture map is an empty map', () => {
    expect(folderMapFrom(null, () => ['x'])).toEqual({roots: [], folders: []});
  });
});

describe('conflictAfterAttempt', () => {
  test('is null when the branch rebases clean', () => {
    expect(conflictAfterAttempt(fake().run, O)).toBeNull();
  });
  test('names the files in conflict and aborts the rebase', () => {
    const {run, calls} = fake({
      ' rebase ': {stdout: '', stderr: 'CONFLICT', exitCode: 1},
      'diff --name-only': ok('a.ts\nb.ts\n'),
    });
    expect(conflictAfterAttempt(run, O)).toEqual(['a.ts', 'b.ts']);
    expect(calls.at(-1)).toContain('rebase --abort');
  });
  test('a rebase that fails without conflicting files is not a conflict', () => {
    const { run } = fake({' rebase ': {stdout: '', stderr: 'boom', exitCode: 1}});
    expect(conflictAfterAttempt(run, O)).toBeNull();
  });
});

describe('finishWorktree', () => {
  test('removes the worktree and keeps the branch', () => {
    const {run, calls} = fake();
    expect(finishWorktree(run, O, false)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('git worktree remove');
  });
  test('drops a conflicted branch locally and on the remote', () => {
    const {run, calls} = fake();
    expect(finishWorktree(run, O, true)).toBeNull();
    expect(calls.slice(1)).toEqual([`git branch -D 'feat/tk-1'`, `git push origin --delete 'feat/tk-1'`]);
  });
  test('reports a worktree that would not come down and drops nothing', () => {
    const {run, calls} = fake({'worktree remove': {stdout: '', stderr: 'locked', exitCode: 1}});
    expect(finishWorktree(run, O, true)).toBe('locked');
    expect(calls).toHaveLength(1);
  });
});
