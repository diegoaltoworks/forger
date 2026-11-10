import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'fs';
import {join} from 'path';

import type {TerminalEvent} from '../loop';
import type {CommandRunner} from '../ports';
import {checksConclusion, closingPrNumber, formatFacts, gatherLoopFacts, parsePr} from './facts';

function stub(answers: Record<string, string>, seen: string[] = []): CommandRunner {
  return cmd => {
    seen.push(cmd);
    return answers[cmd] ?? '';
  };
}

describe('closingPrNumber / parsePr', () => {
  test('takes the newest referenced PR', () => {
    expect(closingPrNumber('{"closedByPullRequestsReferences":[{"number":3},{"number":9}]}')).toBe(9);
  });
  test('null when none or unreadable', () => {
    expect(closingPrNumber('{"closedByPullRequestsReferences":[]}')).toBeNull();
    expect(closingPrNumber('')).toBeNull();
  });
  test('merged from state or mergedAt', () => {
    expect(parsePr('{"number":1,"state":"MERGED"}')?.merged).toBe(true);
    expect(parsePr('{"number":1,"state":"CLOSED","mergedAt":null}')?.merged).toBe(false);
    expect(parsePr('garbage')).toBeNull();
  });
});

describe('gatherLoopFacts', () => {
  const answers = {
    'git branch --show-current': 'feat/issue-5',
    'git rev-parse origin/main': 'abc123',
    'git status --porcelain': ' M .forger/state.json',
    'gh issue view 5 --json state,closedByPullRequestsReferences': '{"state":"CLOSED","closedByPullRequestsReferences":[{"number":7}]}',
    'git ls-tree -r --name-only origin/main -- .github/workflows': '.github/workflows/ci.yml',
    'gh pr view 7 --json number,state,mergedAt,statusCheckRollup,headRefOid': readFileSync(join(import.meta.dir, 'gh-pr-checks-success.json'), 'utf-8'),
  };

  test('reports branch, clean (ignoring engine files), origin head and issue -> PR -> merged', () => {
    const f = gatherLoopFacts(stub(answers), {baseBranch: 'main', ignore: ['.forger/state.json'], issue: 5});
    expect(f).toEqual({
      branch: 'feat/issue-5',
      clean: true,
      base_branch: 'main',
      origin_base_head: 'abc123',
      issue: {number: 5, state: 'CLOSED', closing_pr: {number: 7, state: 'MERGED', merged: true, checks: 'success', checks_ok: true, failing_checks: [], head: null}, delivery: null},
    });
    expect(formatFacts(f)).toContain('PR #7 merged, checks success');
  });

  test('facts reports the delivery outcome for the PR that closed an issue', () => {
    const events = [
      {event: 'delivery_failed', at: 't', iteration: 1, ticket: 'issue-5', reason: 'PR #7: check: `x` exited 1'},
      {event: 'rolled_back', at: 't', iteration: 1, ticket: 'issue-5', reason: 'PR #7: undone'},
    ] as TerminalEvent[];
    const f = gatherLoopFacts(stub(answers), {baseBranch: 'main', ignore: [], issue: 5, events});
    expect(f.issue?.delivery).toBe('rolled_back');
    expect(formatFacts(f)).toContain('delivery rolled_back');
    const other = [{event: 'delivered', at: 't', iteration: 1, ticket: 'issue-9', reason: 'PR #8: ok'}] as TerminalEvent[];
    expect(gatherLoopFacts(stub(answers), {baseBranch: 'main', ignore: [], issue: 5, events: other}).issue?.delivery).toBeNull();
  });

  test('dirty tree, detached HEAD, issue without a PR', () => {
    const f = gatherLoopFacts(stub({'git status --porcelain': '?? x.ts', 'gh issue view 5 --json state,closedByPullRequestsReferences': '{"state":"OPEN","closedByPullRequestsReferences":[]}'}), {baseBranch: 'main', ignore: [], issue: 5});
    expect(f.branch).toBeNull();
    expect(f.clean).toBe(false);
    expect(f.origin_base_head).toBeNull();
    expect(f.issue).toEqual({number: 5, state: 'OPEN', closing_pr: null, delivery: null});
  });

  test('issues only read-only commands', () => {
    const seen: string[] = [];
    gatherLoopFacts(stub(answers, seen), {baseBranch: 'main', ignore: [], issue: 5});
    expect(seen.filter(c => c.startsWith('git ')).every(c => /^git (branch --show-current|fetch --quiet|rev-parse|status --porcelain|ls-tree)/.test(c))).toBe(true);
    expect(seen.filter(c => c.startsWith('gh ')).every(c => /^gh (issue|pr) view/.test(c))).toBe(true);
  });
});

describe('checksConclusion', () => {
  const fixture = (name: string) => JSON.parse(readFileSync(join(import.meta.dir, name), 'utf-8')).statusCheckRollup;
  test('every check run and status passed', () => expect(checksConclusion(fixture('gh-pr-checks-success.json'), true)).toBe('success'));
  test('a failed check run fails even while another is pending', () => expect(checksConclusion(fixture('gh-pr-checks-failure.json'), true)).toBe('failure'));
  test('an unfinished run is pending', () => expect(checksConclusion(fixture('gh-pr-checks-pending.json'), true)).toBe('pending'));
  test('skipped and neutral runs pass', () => {
    expect(checksConclusion([{__typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED'}, {__typename: 'CheckRun', status: 'COMPLETED', conclusion: 'NEUTRAL'}], true)).toBe('success');
  });
  test('a commit status in error fails; one pending is pending', () => {
    expect(checksConclusion([{__typename: 'StatusContext', state: 'ERROR'}], true)).toBe('failure');
    expect(checksConclusion([{__typename: 'StatusContext', state: 'PENDING'}], true)).toBe('pending');
  });
  test('no checks: none without CI, pending (not yet registered) with it', () => {
    expect(checksConclusion([], false)).toBe('none');
    expect(checksConclusion([], true)).toBe('pending');
    expect(checksConclusion(undefined, false)).toBe('none');
  });
  test('checks_ok allows a merge only on success or none', () => {
    const pr = (rollup: unknown, ci: boolean) => parsePr(JSON.stringify({number: 1, state: 'OPEN', statusCheckRollup: rollup}), ci)?.checks_ok;
    expect(pr(fixture('gh-pr-checks-success.json'), true)).toBe(true);
    expect(pr([], false)).toBe(true);
    expect(pr([], true)).toBe(false);
    expect(pr(fixture('gh-pr-checks-failure.json'), true)).toBe(false);
    expect(pr(fixture('gh-pr-checks-pending.json'), true)).toBe(false);
  });
});

describe('gatherLoopFacts --pr', () => {
  test('reports a PR on its own, and no CI configured means none', () => {
    const f = gatherLoopFacts(stub({'gh pr view 8 --json number,state,mergedAt,statusCheckRollup,headRefOid': '{"number":8,"state":"OPEN","statusCheckRollup":[]}'}), {baseBranch: 'main', ignore: [], pr: 8});
    expect(f.pr).toEqual({number: 8, state: 'OPEN', merged: false, checks: 'none', checks_ok: true, failing_checks: [], head: null});
    expect(f.issue).toBeUndefined();
    expect(formatFacts(f)).toContain('PR #8 open, checks none');
  });
  test('a workflow only on HEAD still counts as CI configured', () => {
    const f = gatherLoopFacts(stub({
      'git ls-tree -r --name-only HEAD -- .github/workflows': '.github/workflows/ci.yml',
      'gh pr view 8 --json number,state,mergedAt,statusCheckRollup,headRefOid': '{"number":8,"state":"OPEN","statusCheckRollup":[]}',
    }), {baseBranch: 'main', ignore: [], pr: 8});
    expect(f.pr).toMatchObject({checks: 'pending', checks_ok: false});
  });
  test('no PR lookup without --issue or --pr', () => {
    const seen: string[] = [];
    gatherLoopFacts(stub({}, seen), {baseBranch: 'main', ignore: []});
    expect(seen.some(c => c.includes('ls-tree') || c.startsWith('gh '))).toBe(false);
  });
});
