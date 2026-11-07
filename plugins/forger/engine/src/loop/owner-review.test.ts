import {describe, expect, test} from 'bun:test';

import {issueOfTicket, mergeMode, ownerReviewLabelCommands, ownerReviewRefusal, settleOwnerMerges} from './owner-review';
import {decideOutcome, type RunFacts} from './outcome';
import {backlogReport} from '../backlog/backlog';
import {backlogFromIssues} from '../backlog/github-backlog';
import {mergeConfig} from '../config';
import {mergePr} from './merge';
import type {PrFact} from './pr-checks';

describe('mergeMode', () => {
  test('a ticket with no Merge section merges when green', () => {
    expect(mergeMode('## What to build\n\nx\n')).toBe('when green');
    expect(mergeMode(null)).toBe('when green');
    expect(mergeMode('## Merge\n\n')).toBe('when green');
  });
  test('reads when green and owner reviews, ignoring the template comment and markup', () => {
    expect(mergeMode('## Merge\n\n<!-- when green or owner reviews -->\nwhen green\n')).toBe('when green');
    expect(mergeMode('## What\n\nx\n\n## Merge\n\n`owner reviews`: a taste call\n\n## Guards\n\nnone')).toBe('owner reviews');
    expect(mergeMode('## Merge\n\nOwner reviews\n')).toBe('owner reviews');
  });
  test('an "owner reviews" line under another heading does not count', () => {
    expect(mergeMode('## Guards\n\nowner reviews\n\n## Merge\n\nwhen green')).toBe('when green');
  });
});

describe('merge refusal', () => {
  test('an owner-reviews ticket is refused a merge, naming the PR', () => {
    expect(ownerReviewRefusal('owner reviews', 12)).toContain('PR #12');
    expect(ownerReviewRefusal('when green', 12)).toBeNull();
  });
  test('mergePr refuses before it reads the PR', async () => {
    const calls: string[] = [];
    const r = await mergePr(c => (calls.push(c), ''), {pr: 4, baseBranch: 'main', verdictsDir: '/none', timeoutMs: 0, mode: 'owner reviews'});
    expect(r).toMatchObject({pr: 4, merged: false});
    expect(r.reason).toContain('owner reviews');
    expect(calls).toEqual([]);
  });
});

describe('the owner-review outcome', () => {
  const open: PrFact = {number: 9, state: 'OPEN', merged: false, checks: 'success', checks_ok: true, failing_checks: [], head: 'h', verify_passed: true};
  const facts: RunFacts = {
    merged: false, pushed: true, branch: 'feat/issue-5', ticket: 'issue-5', enginePick: 'issue-5', declined: null, claim: 'complete', stopReason: null,
    exitCode: 0, signal: null, timedOut: false, timeoutMinutes: 45, baseBranch: 'main', backlogCompleted: false, unclean: null, infraError: null,
    conflict: null, pr: open, verdict: 'pass', ownerReviews: true,
  };

  test('an owner-reviews ticket opens a PR, is not merged, and the loop picks the next ticket', () => {
    const o = decideOutcome(facts);
    expect(o).toMatchObject({status: 'owner-review', merged: false, halt: null, ownerReviewPr: 9});
    expect(o.result).not.toBe('failure');
    const labelled = {number: 5, state: 'OPEN' as const, labels: {nodes: [{name: 'ready-for-agent'}, {name: 'owner-review'}]}};
    const next = {number: 6, state: 'OPEN' as const, labels: {nodes: [{name: 'ready-for-agent'}]}};
    const cfg = mergeConfig({tracker: {kind: 'github', label: 'ready-for-agent'}});
    expect(backlogReport(backlogFromIssues([labelled, next], cfg.tracker), cfg).next).toBe('issue-6');
  });
  test('without a passing verdict or green checks it is not handed over', () => {
    expect(decideOutcome({...facts, verdict: 'block'}).status).not.toBe('owner-review');
    expect(decideOutcome({...facts, pr: {...open, checks: 'failure', checks_ok: false}}).status).not.toBe('owner-review');
  });
  test('a when-green ticket left unmerged is still a failure', () => {
    expect(decideOutcome({...facts, ownerReviews: false})).toMatchObject({status: 'failed', result: 'failure'});
  });
});

describe('handing a PR to the owner', () => {
  test('labels the PR and the issue', () => {
    expect(ownerReviewLabelCommands(9, issueOfTicket('issue-5'))).toEqual([
      'gh pr edit 9 --add-label owner-review',
      'gh issue edit 5 --add-label owner-review',
    ]);
    expect(ownerReviewLabelCommands(9, issueOfTicket('other'))).toHaveLength(1);
  });
});

describe('settleOwnerMerges', () => {
  test('an owner-reviews PR merged by the owner counts the ticket completed', () => {
    const s = settleOwnerMerges(['issue-5', 'issue-6'], ['issue-1'], t => t === 'issue-5');
    expect(s).toEqual({pending: ['issue-6'], completed_tasks: ['issue-1', 'issue-5'], completed: ['issue-5']});
  });
  test('nothing changes while the PR is open', () => {
    expect(settleOwnerMerges(['issue-5'], [], () => false).completed).toEqual([]);
  });
});
