import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'fs';
import {join} from 'path';

import {backlogReport} from './backlog';
import {mergeConfig} from '../config';
import {
  type IssueNode,
  type TrackedIssue,
  backlogFromIssues,
  closedByMergedPr,
  githubBacklog,
  issueStatus,
  issuesCommand,
  labelMatches,
  ISSUES_QUERY,
  PAGE,
  QUERY_COST_BUDGET,
  RATE_LIMIT_COMMAND,
  parseIssuesResponse,
  ticketFromIssue,
  truncatedLists,
} from './github-backlog';
import type {CommandResult} from '../ports';
import {graphqlCost} from './graphql-cost';
import {RateLimitError} from '../loop';
import {OPEN_PRS_COMMAND, VIEWER_COMMAND} from './outside-prs';

/** A real `gh api graphql --paginate --slurp` response, recorded. */
const recorded = readFileSync(join(import.meta.dir, 'github-issues.json'), 'utf-8');

const rateLimitStderr = readFileSync(join(import.meta.dir, 'gh-rate-limit.stderr'), 'utf-8');
const rateLimitJson = readFileSync(join(import.meta.dir, 'gh-rate-limit.json'), 'utf-8');

const config = mergeConfig({tracker: {kind: 'github', label: 'ready-for-agent', ignore: ['wayfinder:*']}});
const tracker = config.tracker;

function issue(
  number: number,
  opts: {
    state?: 'OPEN' | 'CLOSED';
    labels?: string[];
    closer?: {__typename: string; merged?: boolean} | null;
    blockedBy?: IssueNode[];
    body?: string;
  } = {}
): TrackedIssue {
  return {
    number,
    state: opts.state ?? 'OPEN',
    labels: {nodes: (opts.labels ?? ['ready-for-agent']).map(name => ({name}))},
    timelineItems: {nodes: opts.closer === undefined ? [] : [{closer: opts.closer}]},
    blockedBy: {nodes: opts.blockedBy ?? []},
    ...(opts.body === undefined ? {} : {body: opts.body}),
  };
}

const mergedPr = {__typename: 'PullRequest', merged: true};

function page(nodes: TrackedIssue[]): unknown {
  return {data: {repository: {issues: {pageInfo: {hasNextPage: false}, nodes}}}};
}

describe('parseIssuesResponse', () => {
  test('reads the recorded response', () => {
    const issues = parseIssuesResponse(recorded);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every(i => typeof i.number === 'number')).toBe(true);
  });

  test('joins every page', () => {
    const raw = JSON.stringify([page([issue(1)]), page([issue(2)])]);
    expect(parseIssuesResponse(raw).map(i => i.number)).toEqual([1, 2]);
  });

  test('an unreadable response throws rather than reading as an empty backlog', () => {
    for (const raw of ['', 'not json', '{}', JSON.stringify([{errors: []}])]) {
      expect(() => parseIssuesResponse(raw)).toThrow(/GitHub backlog/);
    }
  });
});

describe('closedByMergedPr', () => {
  test('only a close by a merged PR counts', () => {
    expect(closedByMergedPr(issue(1, {state: 'CLOSED', closer: mergedPr}))).toBe(true);
    expect(closedByMergedPr(issue(1, {state: 'CLOSED', closer: null}))).toBe(false);
    expect(closedByMergedPr(issue(1, {state: 'CLOSED'}))).toBe(false);
    expect(
      closedByMergedPr(issue(1, {state: 'CLOSED', closer: {__typename: 'PullRequest', merged: false}}))
    ).toBe(false);
    expect(closedByMergedPr(issue(1, {state: 'CLOSED', closer: {__typename: 'Commit'}}))).toBe(false);
  });

  test('a reopened issue with an old merged close is not closed', () => {
    expect(closedByMergedPr(issue(1, {state: 'OPEN', closer: mergedPr}))).toBe(false);
  });
});

describe('issueStatus', () => {
  test('an open intake issue is not started', () => {
    expect(issueStatus(issue(1), tracker)).toBe('not_started');
  });

  test('closed by a merged PR is completed; closed any other way is not', () => {
    expect(issueStatus(issue(1, {state: 'CLOSED', closer: mergedPr}), tracker)).toBe('completed');
    expect(issueStatus(issue(1, {state: 'CLOSED', closer: null}), tracker)).toBe('closed');
  });

  test('needs-human and deferred labels carry those statuses', () => {
    expect(issueStatus(issue(1, {labels: ['ready-for-agent', 'needs-human']}), tracker)).toBe(
      'needs_human'
    );
    expect(issueStatus(issue(1, {labels: ['ready-for-agent', 'deferred']}), tracker)).toBe('deferred');
  });

  test('an issue that is not work is satisfied once closed, PR or not', () => {
    expect(issueStatus(issue(1, {labels: []}), tracker)).toBe('untracked');
    expect(issueStatus(issue(1, {labels: [], state: 'CLOSED'}), tracker)).toBe('completed');
    const decision = issue(1, {labels: ['ready-for-agent', 'wayfinder:decision']});
    expect(issueStatus(decision, tracker)).toBe('untracked');
  });
});

describe('ticketFromIssue', () => {
  test('maps priority and effort labels', () => {
    const t = ticketFromIssue(issue(7, {labels: ['ready-for-agent', 'P1', 'effort:large']}), tracker);
    expect(t).toEqual({status: 'not_started', issue: 7, priority: 'P1', effort: 'large'});
  });

  test('maps native blocked-by to depends_on', () => {
    const t = ticketFromIssue(issue(7, {blockedBy: [issue(3), issue(5)]}), tracker);
    expect(t.depends_on).toEqual(['issue-3', 'issue-5']);
  });

  test('a label that only looks like a priority is ignored', () => {
    expect(ticketFromIssue(issue(7, {labels: ['ready-for-agent', 'P9']}), tracker).priority).toBeUndefined();
  });
});

describe('labelMatches', () => {
  test('a trailing star matches a prefix; otherwise the match is exact', () => {
    expect(labelMatches('wayfinder:map', 'wayfinder:*')).toBe(true);
    expect(labelMatches('wayfinder', 'wayfinder:*')).toBe(false);
    expect(labelMatches('question', 'question')).toBe(true);
    expect(labelMatches('questions', 'question')).toBe(false);
  });
});

describe('backlogFromIssues', () => {
  test('orders by priority, then by issue number, and respects blocked-by', () => {
    const issues = [
      issue(9, {labels: ['ready-for-agent', 'P0'], blockedBy: [issue(4)]}),
      issue(6),
      issue(4, {labels: ['ready-for-agent', 'P1']}),
      issue(2),
      issue(1, {state: 'CLOSED', closer: mergedPr, labels: ['ready-for-agent', 'P0']}),
    ];
    expect(backlogReport(backlogFromIssues(issues, tracker), config)).toEqual({
      workable: [
        {id: 'issue-4', priority: 'P1'},
        {id: 'issue-2', priority: 'P3'},
        {id: 'issue-6', priority: 'P3'},
      ],
      remaining: 4,
      next: 'issue-4',
      anomalies: [],
      held: [],
    });
  });

  test('a ticket blocked by an owner-reviews ticket waits until its PR merges', () => {
    const waiting = issue(1, {labels: ['ready-for-agent', 'owner-review']});
    const open = backlogFromIssues([waiting, issue(2, {blockedBy: [waiting]}), issue(3, {labels: ['ready-for-agent', 'P0']})], tracker);
    expect(open.features['issue-1']).toMatchObject({status: 'owner_review'});
    expect(backlogReport(open, config).workable.map(w => w.id)).toEqual(['issue-3']);

    const merged = issue(1, {state: 'CLOSED', closer: mergedPr, labels: ['ready-for-agent', 'owner-review']});
    const after = backlogFromIssues([merged, issue(2, {blockedBy: [merged]})], tracker);
    expect(after.features['issue-1']).toMatchObject({status: 'completed'});
    expect(backlogReport(after, config).workable.map(w => w.id)).toEqual(['issue-2']);
  });

  test('a blocker closed without a merged PR still blocks', () => {
    const blocker = issue(1, {state: 'CLOSED', closer: null});
    const data = backlogFromIssues([blocker, issue(2, {blockedBy: [blocker]})], tracker);
    expect(backlogReport(data, config).workable).toEqual([]);
  });

  test('a blocker outside the intake set is tracked by its own state', () => {
    const open = issue(50, {labels: []});
    const closed = issue(51, {labels: ['wayfinder:decision'], state: 'CLOSED'});
    const data = backlogFromIssues(
      [issue(2, {blockedBy: [open]}), issue(3, {blockedBy: [closed]})],
      tracker
    );
    expect(data.features['issue-50']).toEqual({status: 'untracked', issue: 50});
    expect(data.features['issue-51']).toEqual({status: 'completed', issue: 51});
    expect(backlogReport(data, config)).toEqual({
      workable: [{id: 'issue-3', priority: 'P3'}],
      remaining: 2,
      next: 'issue-3',
      anomalies: [],
      held: [],
    });
  });

  test('ignored issues are never work, only when configured', () => {
    const issues = [issue(1, {labels: ['ready-for-agent', 'wayfinder:map']}), issue(2)];
    expect(backlogReport(backlogFromIssues(issues, tracker), config).workable).toEqual([
      {id: 'issue-2', priority: 'P3'},
    ]);
    const unfiltered = mergeConfig({});
    expect(backlogReport(backlogFromIssues(issues, unfiltered.tracker), unfiltered).remaining).toBe(2);
  });

  test('an ignored intake issue blocks until closed, then releases its dependants', () => {
    const labels = ['ready-for-agent', 'wayfinder:decision'];
    const open = issue(1, {labels});
    const blocked = (decision: TrackedIssue) => [decision, issue(2, {blockedBy: [decision]})];
    expect(backlogReport(backlogFromIssues(blocked(open), tracker), config).workable).toEqual([]);
    const closed = issue(1, {labels, state: 'CLOSED', closer: null});
    expect(backlogReport(backlogFromIssues(blocked(closed), tracker), config).next).toBe('issue-2');
  });

  test('the recorded response maps to a consistent backlog', () => {
    const data = backlogFromIssues(parseIssuesResponse(recorded), tracker);
    const report = backlogReport(data, config);
    for (const t of Object.values(data.features) as Array<{status: string; depends_on?: string[]}>) {
      for (const dep of t.depends_on ?? []) expect(data.features[dep]).toBeDefined();
    }
    expect(report.next).toBe(report.workable[0]?.id ?? null);
    expect(report.remaining).toBeGreaterThanOrEqual(report.workable.length);
  });
});

const ok = (stdout: string): CommandResult => ({stdout, stderr: '', exitCode: 0});

describe('githubBacklog', () => {
  test('reads tickets once from a gh graphql call with the intake label, until refreshed', () => {
    const calls: string[] = [];
    const backlog = githubBacklog(cmd => {
      if (cmd === VIEWER_COMMAND) return ok('loop\n');
      if (cmd === OPEN_PRS_COMMAND) return ok('[]');
      calls.push(cmd);
      return ok(JSON.stringify([page([issue(3, {labels: ['ready-for-agent', 'P0']})])]));
    }, config);
    expect(backlog.next()).toBe('issue-3');
    expect(backlog.tier('issue-3')).toEqual(config.model_by_priority.P0);
    backlog.report();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toStartWith('gh api graphql --paginate --slurp');
    expect(calls[0]).toContain("-f label='ready-for-agent'");
    backlog.refresh();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(calls[0]);
  });

  test('empty output throws with what gh printed on stderr, not a guess', () => {
    const failed = githubBacklog(() => ({stdout: '', stderr: 'HTTP 502: Bad Gateway', exitCode: 1}), config);
    expect(() => failed.remaining()).toThrow('GitHub backlog: gh exited 1 with no output, on stderr: HTTP 502: Bad Gateway');
    const silent = githubBacklog(() => ok(''), config);
    expect(() => silent.remaining()).toThrow('GitHub backlog: gh exited 0 with no output, nothing on stderr');
  });

  test("gh's rate-limit stderr is a rate-limit infrastructure error with the reset time", () => {
    const calls: string[] = [];
    const backlog = githubBacklog(cmd => {
      calls.push(cmd);
      if (cmd === RATE_LIMIT_COMMAND) return ok(rateLimitJson);
      return {stdout: '', stderr: rateLimitStderr, exitCode: 1};
    }, config);
    let error: unknown;
    try {
      backlog.remaining();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RateLimitError);
    const limited = error as RateLimitError;
    expect(limited.window).toEqual({resource: 'graphql', limit: 5000, remaining: 0, resetAt: 1793703600000});
    expect(limited.message).toContain('Infrastructure error (rate_limit)');
    expect(limited.message).toContain('GitHub graphql rate limit (5000 an hour)');
    expect(limited.message).toContain(`resets at ${new Date(1793703600000).toISOString()}`);
    expect(calls).toEqual([calls[0], RATE_LIMIT_COMMAND]);
  });

  test('a rate limit whose reset cannot be read still reads as a rate limit', () => {
    const backlog = githubBacklog(
      cmd => (cmd === RATE_LIMIT_COMMAND ? {stdout: '', stderr: 'boom', exitCode: 1} : {stdout: '', stderr: rateLimitStderr, exitCode: 1}),
      config
    );
    expect(() => backlog.remaining()).toThrow(/rate_limit.*reset time unknown/);
  });
});

describe('the backlog query cost', () => {
  test('stays within its budget', () => {
    expect(graphqlCost(ISSUES_QUERY)).toBeLessThanOrEqual(QUERY_COST_BUDGET);
  });

  test('a page size raised past the budget breaks it', () => {
    const raised = ISSUES_QUERY.replace(`blockedBy(first: ${PAGE.blockers})`, 'blockedBy(first: 50)');
    expect(raised).not.toBe(ISSUES_QUERY);
    expect(graphqlCost(raised)).toBeGreaterThan(QUERY_COST_BUDGET);
  });
});

describe('parseIssuesResponse with recently closed issues', () => {
  function pageWithClosed(nodes: TrackedIssue[], closed: TrackedIssue[]): unknown {
    return {data: {repository: {issues: {nodes}, closed: {nodes: closed}}}};
  }

  test('keeps each issue once though the closed list repeats on every page', () => {
    const done = issue(1, {state: 'CLOSED', closer: mergedPr});
    const raw = JSON.stringify([pageWithClosed([issue(2)], [done]), pageWithClosed([issue(3)], [done])]);
    expect(parseIssuesResponse(raw).map(i => i.number).sort()).toEqual([1, 2, 3]);
    expect(backlogFromIssues(parseIssuesResponse(raw), tracker).features['issue-1']).toMatchObject({status: 'completed'});
  });

  test('a list longer than its page fails the read instead of dropping entries', () => {
    const many = {...issue(2), blockedBy: {totalCount: PAGE.blockers + 1, nodes: [issue(1)]}};
    expect(() => parseIssuesResponse(JSON.stringify([page([many])]))).toThrow(/more than a page of blockers on #2/);
    expect(truncatedLists([{...issue(4), labels: {totalCount: 3, nodes: [{name: 'a'}]}}])).toEqual(['labels on #4']);
  });
});

describe('issuesCommand', () => {
  test('quotes a label containing a single quote', () => {
    expect(issuesCommand({...tracker, label: "it's ready"})).toContain(`-f label='it'\\''s ready'`);
  });
});

describe('a blocker written only in the body', () => {
  const blocked = '## What\n\nx\n\n## Blocked by\n\n- #81\n';

  test('is a dependency: the ticket is not workable, and the mismatch is reported', () => {
    const data = backlogFromIssues([issue(81), issue(82, {body: blocked})], tracker);
    const report = backlogReport(data, config);
    expect(report.workable.map(w => w.id)).toEqual(['issue-81']);
    expect(report.anomalies).toEqual(['#82 lists #81 under Blocked by but it is not linked as blocked-by']);
  });

  test('a closed blocker no longer blocks and is not reported', () => {
    const data = backlogFromIssues([issue(81, {state: 'CLOSED', closer: mergedPr}), issue(82, {body: blocked})], tracker);
    const report = backlogReport(data, config);
    expect(report.workable.map(w => w.id)).toEqual(['issue-82']);
    expect(report.anomalies).toEqual([]);
  });

  test('a native blocker the body omits is reported but still blocks', () => {
    const data = backlogFromIssues([issue(81), issue(82, {blockedBy: [issue(81)], body: '## Blocked by\n\nNone'})], tracker);
    const report = backlogReport(data, config);
    expect(report.workable.map(w => w.id)).toEqual(['issue-81']);
    expect(report.anomalies).toEqual(['#82 is linked as blocked by #81 but its Blocked by section does not list it']);
  });

  test('both agreeing report nothing, and the blocker is listed once', () => {
    const data = backlogFromIssues([issue(81), issue(82, {blockedBy: [issue(81)], body: blocked})], tracker);
    expect(backlogReport(data, config).anomalies).toEqual([]);
    expect((data.features['issue-82'] as {depends_on: string[]}).depends_on).toEqual(['issue-81']);
  });
});

describe('an open outside PR', () => {
  const ready = ['ready-for-agent', 'P1'];
  const prs = (list: unknown[]) => JSON.stringify(list);
  const tracked = (prList: unknown, viewer = 'loop') =>
    githubBacklog(cmd => {
      if (cmd === VIEWER_COMMAND) return ok(`${viewer}\n`);
      if (cmd === OPEN_PRS_COMMAND) return typeof prList === 'string' && prList === 'fail' ? {stdout: '', stderr: 'boom', exitCode: 1} : ok(prs(prList as unknown[]));
      return ok(JSON.stringify([page([issue(3, {labels: ready}), issue(4, {labels: ['ready-for-agent', 'P2']})])]));
    }, config);

  test('an open outside PR for a ticket holds the pick', () => {
    const backlog = tracked([{number: 188, title: 'fix the thing', author: {login: 'someone'}, closingIssuesReferences: [{number: 3}]}]);
    expect(backlog.next()).toBe('issue-4');
    const report = backlog.report();
    expect(report.held).toEqual([{id: 'issue-3', prs: [188]}]);
    expect(report.remaining).toBe(2);
    expect(backlog.blocked().map(b => b.id)).toEqual(['issue-3']);
    expect(backlog.blocked()[0]?.blockedBy[0]?.id).toBe('PR #188');
  });

  test('the issue number in the title holds the ticket too', () => {
    const backlog = tracked([{number: 9, title: 'Fix #3 properly', author: {login: 'someone'}, closingIssuesReferences: []}]);
    expect(backlog.report().held).toEqual([{id: 'issue-3', prs: [9]}]);
  });

  test('a longer number in the title does not match', () => {
    const backlog = tracked([{number: 9, title: 'Fix #33', author: {login: 'someone'}, closingIssuesReferences: []}]);
    expect(backlog.report().held).toEqual([]);
  });

  test("the loop's own PR holds nothing", () => {
    const backlog = tracked([{number: 5, title: 'feat: x', author: {login: 'Loop'}, closingIssuesReferences: [{number: 3}]}]);
    expect(backlog.next()).toBe('issue-3');
    expect(backlog.report().anomalies).toEqual([]);
  });

  test('an outside PR is an anomaly even when it references no ticket', () => {
    const backlog = tracked([{number: 7, title: 'docs', author: {login: 'someone'}, closingIssuesReferences: []}]);
    expect(backlog.report().anomalies).toEqual([expect.stringContaining('PR #7 from someone')]);
    expect(backlog.next()).toBe('issue-3');
  });

  test('an unreadable PR list is reported, not read as none', () => {
    const backlog = tracked('fail');
    expect(backlog.report().anomalies).toEqual([expect.stringContaining('could not be read')]);
  });
});
