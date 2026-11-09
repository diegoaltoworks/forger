import {describe, expect, test} from 'bun:test';

import type {CapturingRunner, CommandResult} from '../ports';
import {createWorktree, rebaseOnBase, removeWorktree, ticketBranch, validTicket, worktreePath} from './worktree';

const O = {ticket: 'issue-9', baseBranch: 'main', stateDir: '/r/.forger'};
const NO_BRANCH = {'rev-parse': {stdout: '', stderr: '', exitCode: 1}};
const PATH = '/r/.forger/worktrees/issue-9';

const ok = (stdout = ''): CommandResult => ({stdout, stderr: '', exitCode: 0});
const bad = (stderr: string, stdout = ''): CommandResult => ({stdout, stderr, exitCode: 1});

function fake(replies: Record<string, CommandResult>): {run: CapturingRunner; calls: string[]} {
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

describe('names', () => {
  test('branch and path follow the ticket', () => {
    expect(ticketBranch('issue-9')).toBe('feat/issue-9');
    expect(worktreePath('/r/.forger', 'issue-9')).toBe(PATH);
  });
  test('ticket ids with separators or shell syntax are refused', () => {
    expect(validTicket('issue-9')).toBe(true);
    for (const t of ['', '../x', 'a/b', 'a;rm', 'a b', '-x', 'a..b']) expect(validTicket(t)).toBe(false);
  });
});

describe('createWorktree', () => {
  test('fetches the base, then adds the worktree on a new branch from it', () => {
    const {run, calls} = fake(NO_BRANCH);
    expect(createWorktree(run, O)).toEqual({ok: true, ticket: 'issue-9', branch: 'feat/issue-9', path: PATH, error: null});
    expect(calls).toEqual([
      `git fetch origin 'main'`,
      `git rev-parse --verify --quiet 'refs/heads/feat/issue-9'`,
      `git worktree add -b 'feat/issue-9' '${PATH}' 'origin/main'`,
    ]);
  });
  test('a branch left by an earlier attempt is checked out, not created again', () => {
    const {run, calls} = fake({});
    expect(createWorktree(run, O)).toMatchObject({ok: true, error: null});
    expect(calls.at(-1)).toBe(`git worktree add '${PATH}' 'feat/issue-9'`);
  });
  test("git's progress on stderr with a zero exit is a created worktree, not an error", () => {
    const {run} = fake({...NO_BRANCH, 'worktree add': {stdout: '', stderr: "Preparing worktree (new branch 'feat/issue-9')", exitCode: 0}});
    expect(createWorktree(run, O)).toEqual({ok: true, ticket: 'issue-9', branch: 'feat/issue-9', path: PATH, error: null});
  });
  test('a failure names the fatal line, not the progress line before it', () => {
    const {run} = fake({
      ...NO_BRANCH,
      'worktree add': bad(`Preparing worktree (new branch 'feat/issue-9')\nfatal: '${PATH}' already exists`),
    });
    expect(createWorktree(run, O)).toMatchObject({ok: false, error: `fatal: '${PATH}' already exists`});
  });
  test('never runs a command that moves the main checkout', () => {
    const {run, calls} = fake({});
    createWorktree(run, O);
    expect(calls.some(c => /checkout|switch|reset|rebase|pull/.test(c))).toBe(false);
  });
  test('a failed fetch stops before adding', () => {
    const {run, calls} = fake({fetch: bad('no network')});
    const r = createWorktree(run, O);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('fetch failed: no network');
    expect(calls).toHaveLength(1);
  });
  test('a branch that exists is reported', () => {
    const {run} = fake({...NO_BRANCH, 'worktree add': bad("fatal: a branch named 'feat/issue-9' already exists")});
    expect(createWorktree(run, O)).toMatchObject({ok: false, error: expect.stringContaining('already exists')});
  });
  test('an unusable ticket runs nothing', () => {
    const {run, calls} = fake({});
    expect(createWorktree(run, {...O, ticket: '../x'}).ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('removeWorktree', () => {
  test('removes the worktree and leaves the branch', () => {
    const {run, calls} = fake({});
    expect(removeWorktree(run, O)).toMatchObject({ok: true, path: PATH, error: null});
    expect(calls).toEqual([`git worktree remove --force '${PATH}'`]);
  });
  test('a missing worktree is an error', () => {
    const {run} = fake({'worktree remove': bad("fatal: '/x' is not a working tree")});
    expect(removeWorktree(run, O)).toMatchObject({ok: false, error: expect.stringContaining('not a working tree')});
  });
});

describe('rebaseOnBase', () => {
  test('clean: fetch then rebase inside the worktree', () => {
    const {run, calls} = fake({});
    expect(rebaseOnBase(run, O)).toEqual({status: 'clean', ticket: 'issue-9', branch: 'feat/issue-9', path: PATH, onto: 'origin/main', next: null});
    expect(calls).toEqual([
      `git -C '${PATH}' fetch origin 'main'`,
      `git -C '${PATH}' rev-parse HEAD`,
      `git -C '${PATH}' rebase 'origin/main'`,
      `git -C '${PATH}' rev-parse HEAD`,
    ]);
  });
  test('rebase that rewrites the branch reports the force-with-lease push as next', () => {
    const heads = ['aaa', 'bbb'];
    const run: CapturingRunner = cmd => (cmd.includes('rev-parse') ? ok(heads.shift() ?? '') : ok());
    expect(rebaseOnBase(run, O)).toMatchObject({status: 'clean', next: 'git push --force-with-lease origin feat/issue-9'});
  });
  test('conflict lists the unmerged files', () => {
    const {run, calls} = fake({
      ' rebase ': bad('CONFLICT (content): Merge conflict in a.ts'),
      'diff --name-only': ok('a.ts\ndocs/b.md\n'),
    });
    const r = rebaseOnBase(run, O);
    expect(r).toMatchObject({status: 'conflict', files: ['a.ts', 'docs/b.md']});
    expect(calls.every(c => c.startsWith(`git -C '${PATH}'`))).toBe(true);
  });
  test('a rebase that fails without conflicts is an error, not a conflict', () => {
    const {run} = fake({' rebase ': bad('fatal: invalid upstream'), 'diff --name-only': ok('')});
    expect(rebaseOnBase(run, O)).toMatchObject({status: 'error', error: 'fatal: invalid upstream'});
  });
  test('a failed fetch is an error and no rebase runs', () => {
    const {run, calls} = fake({fetch: bad('offline')});
    expect(rebaseOnBase(run, O)).toMatchObject({status: 'error', error: 'fetch failed: offline'});
    expect(calls).toHaveLength(1);
  });
});
