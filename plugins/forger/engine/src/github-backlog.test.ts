import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'fs';
import {join} from 'path';

import {backlogReport} from './backlog';
import {mergeConfig} from './config';
import {
  type IssueNode,
  type TrackedIssue,
  backlogFromIssues,
  closedByMergedPr,
  githubBacklog,
  issueStatus,
  issuesCommand,
  labelMatches,
  parseIssuesResponse,
  ticketFromIssue,
} from './github-backlog';

/** A real `gh api graphql --paginate --slurp` response, recorded. */
const recorded = readFileSync(join(import.meta.dir, 'fixtures', 'github-issues.json'), 'utf-8');

const config = mergeConfig({tracker: {kind: 'github', label: 'ready-for-agent', ignore: ['wayfinder:*']}});
const tracker = config.tracker;

function issue(
  number: number,
  opts: {
    state?: 'OPEN' | 'CLOSED';
    labels?: string[];
    closer?: {__typename: string; merged?: boolean} | null;
    blockedBy?: IssueNode[];
  } = {}
): TrackedIssue {
  return {
    number,
    state: opts.state ?? 'OPEN',
    labels: {nodes: (opts.labels ?? ['ready-for-agent']).map(name => ({name}))},
    timelineItems: {nodes: opts.closer === undefined ? [] : [{closer: opts.closer}]},
    blockedBy: {nodes: opts.blockedBy ?? []},
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
    });
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

describe('githubBacklog', () => {
  test('reads tickets from a gh graphql call with the intake label, afresh on every call', () => {
    const calls: string[] = [];
    const backlog = githubBacklog(cmd => {
      calls.push(cmd);
      return JSON.stringify([page([issue(3, {labels: ['ready-for-agent', 'P0']})])]);
    }, config);
    expect(backlog.next()).toBe('issue-3');
    expect(backlog.tier('issue-3')).toEqual(config.model_by_priority.P0);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(calls[0]);
    expect(calls[0]).toStartWith('gh api graphql --paginate --slurp');
    expect(calls[0]).toContain("-f label='ready-for-agent'");
  });

  test('a failed gh call throws instead of reporting an empty backlog', () => {
    const backlog = githubBacklog(() => '', config);
    expect(() => backlog.remaining()).toThrow(/GitHub backlog/);
  });
});

describe('issuesCommand', () => {
  test('quotes a label containing a single quote', () => {
    expect(issuesCommand({...tracker, label: "it's ready"})).toContain(`-f label='it'\\''s ready'`);
  });
});
