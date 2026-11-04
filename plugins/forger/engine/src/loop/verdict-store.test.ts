import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, realpathSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {isProjectRoot} from '../config';
import type {CommandRunner} from '../ports';
import {loopRootOf, recordedDecision, verdictsHome} from './verdict-store';
import type {VerdictRecord} from './verify-input';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

const COMMON_DIR = 'git rev-parse --path-format=absolute --git-common-dir';

/** A main checkout with a worker worktree under its state directory, each a project root. */
function checkoutWithWorktree(): {main: string; worktree: string} {
  const main = realpathSync(mkdtempSync(join(tmpdir(), 'forger-verdicts-')));
  dirs.push(main);
  mkdirSync(join(main, '.forger'));
  const worktree = join(main, '.forger', 'worktrees', 'issue-9');
  mkdirSync(join(worktree, '.forger'), {recursive: true});
  return {main, worktree};
}

function record(head: string, decision: VerdictRecord['decision']): VerdictRecord {
  return {pr: 9, head, decision, entries: []} as unknown as VerdictRecord;
}

describe('verdictsHome', () => {
  test('run in a worker worktree, verdicts go to the main checkout the engine reads', () => {
    const {main, worktree} = checkoutWithWorktree();
    const run: CommandRunner = cmd => (cmd === COMMON_DIR ? join(main, '.git') : '');
    expect(loopRootOf(run, worktree)).toBe(main);
    expect(verdictsHome(run, worktree, '.forger/verdicts')).toBe(join(main, '.forger', 'verdicts'));
  });

  test('in the main checkout itself, verdicts stay there', () => {
    const {main} = checkoutWithWorktree();
    const run: CommandRunner = cmd => (cmd === COMMON_DIR ? join(main, '.git') : '');
    expect(verdictsHome(run, main, '.forger/verdicts')).toBe(join(main, '.forger', 'verdicts'));
  });

  test('when git cannot tell, or names a directory that is no project, the checkout it ran in is the home', () => {
    const {worktree} = checkoutWithWorktree();
    expect(loopRootOf(() => '', worktree)).toBe(worktree);
    expect(loopRootOf(() => '.git', worktree)).toBe(worktree);
    expect(loopRootOf(() => '/nowhere/.git', worktree, isProjectRoot)).toBe(worktree);
    expect(loopRootOf(() => {
      throw new Error('no git');
    }, worktree)).toBe(worktree);
  });
});

describe('recordedDecision', () => {
  test('a record for the head wins over the status', () => {
    expect(recordedDecision([record('h1', 'block')], 'h1', true)).toBe('block');
    expect(recordedDecision([record('h1', 'pass')], 'h1', false)).toBe('pass');
  });

  test('with no record for the head, a passing forger/verify status counts as a pass', () => {
    expect(recordedDecision([], 'h1', true)).toBe('pass');
    expect(recordedDecision([record('h0', 'pass')], 'h1', true)).toBe('pass');
  });

  test('with neither a record nor a passing status there is no verdict', () => {
    expect(recordedDecision([], 'h1', false)).toBeNull();
    expect(recordedDecision([record('h0', 'pass')], 'h1', false)).toBeNull();
    expect(recordedDecision([], null, true)).toBeNull();
  });
});
