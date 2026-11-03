import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'fs';
import {join} from 'path';

import type {CommandRunner} from './git';
import {closingPrNumber, formatFacts, gatherLoopFacts, mutatingGitLines, parsePr} from './facts';

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
    'git status --porcelain': ' M .claude/state.json',
    'gh issue view 5 --json state,closedByPullRequestsReferences': '{"state":"CLOSED","closedByPullRequestsReferences":[{"number":7}]}',
    'gh pr view 7 --json number,state,mergedAt': '{"number":7,"state":"MERGED","mergedAt":"2026-01-01T00:00:00Z"}',
  };

  test('reports branch, clean (ignoring engine files), origin head and issue -> PR -> merged', () => {
    const f = gatherLoopFacts(stub(answers), {baseBranch: 'main', ignore: ['.claude/state.json'], issue: 5});
    expect(f).toEqual({
      branch: 'feat/issue-5',
      clean: true,
      base_branch: 'main',
      origin_base_head: 'abc123',
      issue: {number: 5, state: 'CLOSED', closing_pr: {number: 7, state: 'MERGED', merged: true}},
    });
    expect(formatFacts(f)).toContain('PR #7 merged');
  });

  test('dirty tree, detached HEAD, issue without a PR', () => {
    const f = gatherLoopFacts(stub({'git status --porcelain': '?? x.ts', 'gh issue view 5 --json state,closedByPullRequestsReferences': '{"state":"OPEN","closedByPullRequestsReferences":[]}'}), {baseBranch: 'main', ignore: [], issue: 5});
    expect(f.branch).toBeNull();
    expect(f.clean).toBe(false);
    expect(f.origin_base_head).toBeNull();
    expect(f.issue).toEqual({number: 5, state: 'OPEN', closing_pr: null});
  });

  test('issues only read-only commands', () => {
    const seen: string[] = [];
    gatherLoopFacts(stub(answers, seen), {baseBranch: 'main', ignore: [], issue: 5});
    expect(seen.filter(c => c.startsWith('git ')).every(c => /^git (branch --show-current|fetch --quiet|rev-parse|status --porcelain)/.test(c))).toBe(true);
    expect(seen.filter(c => c.startsWith('gh ')).every(c => /^gh (issue|pr) view/.test(c))).toBe(true);
  });
});

describe('mutatingGitLines', () => {
  test('flags state-changing git commands', () => {
    expect(mutatingGitLines('run `git checkout main`\nok\ngit stash')).toHaveLength(2);
  });
  test('reads are fine', () => {
    expect(mutatingGitLines('git fetch\ngit log\ngit branch --show-current')).toEqual([]);
  });
  test('the supervisor command contains no state-changing git command ', () => {
    const body = readFileSync(join(import.meta.dir, '../../commands/work.md'), 'utf-8');
    expect(mutatingGitLines(body)).toEqual([]);
  });
});
