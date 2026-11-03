import {describe, expect, test} from 'bun:test';

import type {CommandRunner} from '../ports';
import {branchFromReflog, gatherFacts, mergedFrom, takeSnapshot, ticketFromBranch} from './run-facts';

function stubRunner(answers: Record<string, string>): CommandRunner {
  return (cmd: string) => answers[cmd] ?? '';
}

function prJson(state: string, conclusion: string): string {
  return JSON.stringify({
    number: 9,
    state,
    mergedAt: state === 'MERGED' ? '2026-01-01T00:00:00Z' : null,
    statusCheckRollup: [{__typename: 'CheckRun', name: 'gates', status: 'COMPLETED', conclusion}],
  });
}

describe('branchFromReflog', () => {
  test('finds the newest branch HEAD moved to', () => {
    const subjects = [
      'checkout: moving from feat/b to main',
      'commit: feat: b',
      'checkout: moving from main to feat/b',
      'checkout: moving from main to feat/a',
    ];
    expect(branchFromReflog(subjects, 'main')).toBe('feat/b');
  });

  test('null when the run never left base', () => {
    expect(branchFromReflog(['pull: Fast-forward', 'checkout: moving from x to main'], 'main')).toBeNull();
  });

  test('ignores detached checkouts', () => {
    expect(branchFromReflog(['checkout: moving from main to 9a51360'], 'main')).toBeNull();
  });
});

describe('ticketFromBranch', () => {
  test('strips the branch prefix', () => {
    expect(ticketFromBranch('feat/the_ticket')).toBe('the_ticket');
  });
  test('a branch without a prefix is the ticket id', () => {
    expect(ticketFromBranch('the_ticket')).toBe('the_ticket');
  });
  test('null for no branch', () => {
    expect(ticketFromBranch(null)).toBeNull();
  });
});

describe('mergedFrom', () => {
  test('a merged PR is a merge even if base looks unmoved', () => {
    expect(mergedFrom('MERGED', false)).toBe(true);
  });
  test('an open or closed PR is not a merge even if base moved', () => {
    expect(mergedFrom('OPEN', true)).toBe(false);
    expect(mergedFrom('CLOSED', true)).toBe(false);
  });
  test('no readable PR falls back to base moving', () => {
    expect(mergedFrom('', true)).toBe(true);
    expect(mergedFrom('', false)).toBe(false);
  });
});

describe('takeSnapshot and gatherFacts', () => {
  const reflogBefore = 'checkout: moving from feat/old to main\ncommit: old';

  test('a merge during the run, branch deleted and back on base', () => {
    const before = takeSnapshot(
      stubRunner({'git rev-parse origin/main': 'aaa', 'git reflog --format=%gs': reflogBefore}),
      'main'
    );
    expect(before).toEqual({baseSha: 'aaa', reflogLength: 2});

    const facts = gatherFacts(
      stubRunner({
        'git rev-parse origin/main': 'bbb',
        'git merge-base --is-ancestor aaa bbb && echo yes': 'yes',
        'git reflog --format=%gs': [
          'pull: Fast-forward',
          'checkout: moving from feat/new to main',
          'commit: feat: new',
          'checkout: moving from main to feat/new',
          reflogBefore,
        ].join('\n'),
        'git branch --show-current': 'main',
        'gh pr view feat/new --json number,state,mergedAt,statusCheckRollup': prJson('MERGED', 'SUCCESS'),
        'git ls-tree -r --name-only origin/main -- .github/workflows': '.github/workflows/ci.yml',
      }),
      'main',
      before
    );
    expect(facts).toEqual({
      merged: true,
      branch: 'feat/new',
      pushed: false,
      pr: {number: 9, state: 'MERGED', merged: true, checks: 'success', checks_ok: true, failing_checks: []},
    });
  });

  test('a merge on failing checks carries the PR and the failing check', () => {
    const facts = gatherFacts(
      stubRunner({
        'git rev-parse origin/main': 'aaa',
        'git reflog --format=%gs': 'checkout: moving from main to feat/new',
        'git branch --show-current': 'main',
        'gh pr view feat/new --json number,state,mergedAt,statusCheckRollup': prJson('MERGED', 'FAILURE'),
      }),
      'main',
      {baseSha: 'aaa', reflogLength: 0}
    );
    expect(facts.merged).toBe(true);
    expect(facts.pr).toMatchObject({number: 9, checks: 'failure', checks_ok: false, failing_checks: ['gates']});
  });

  test('base moved by someone else while the worker\'s PR is open', () => {
    const facts = gatherFacts(
      stubRunner({
        'git rev-parse origin/main': 'bbb',
        'git merge-base --is-ancestor aaa bbb && echo yes': 'yes',
        'git reflog --format=%gs': 'checkout: moving from main to feat/new',
        'git branch --show-current': 'feat/new',
        'gh pr view feat/new --json number,state,mergedAt,statusCheckRollup': prJson('OPEN', 'SUCCESS'),
      }),
      'main',
      {baseSha: 'aaa', reflogLength: 0}
    );
    expect(facts.merged).toBe(false);
  });

  test('pushed but not merged, still on the branch', () => {
    const facts = gatherFacts(
      stubRunner({
        'git rev-parse origin/main': 'aaa',
        'git reflog --format=%gs': 'checkout: moving from main to feat/new\n' + reflogBefore,
        'git branch --show-current': 'feat/new',
        'git ls-remote --heads origin feat/new': 'ccc\trefs/heads/feat/new',
      }),
      'main',
      {baseSha: 'aaa', reflogLength: 2}
    );
    expect(facts).toEqual({merged: false, branch: 'feat/new', pushed: true, pr: null});
  });

  test('does not attribute an older run\'s branch to this one', () => {
    const facts = gatherFacts(
      stubRunner({
        'git rev-parse origin/main': 'aaa',
        'git reflog --format=%gs': reflogBefore,
        'git branch --show-current': 'main',
      }),
      'main',
      {baseSha: 'aaa', reflogLength: 2}
    );
    expect(facts).toEqual({merged: false, branch: null, pushed: false, pr: null});
  });

  test('an unreadable remote base counts no merge', () => {
    const facts = gatherFacts(stubRunner({'git rev-parse origin/main': 'bbb'}), 'main', {
      baseSha: '',
      reflogLength: 0,
    });
    expect(facts.merged).toBe(false);
  });
});
