import {describe, expect, test} from 'bun:test';

import {mergeConfig} from '../../config';
import {RateLimitError, TrackerUnreachableError} from '../../loop';
import type {CommandResult} from '../../ports';
import {type JiraErrors, jiraBacklog, jiraFailure, readJiraBacklog} from './reader';
import {backlogFromJiraIssues, type JiraIssue} from './parse';
import {jiraQuery, searchCommand} from './query';

const errors: JiraErrors = {
  rateLimit: (wait, now, message) => new RateLimitError('jira', {resource: 'jira', limit: 0, remaining: 0, resetAt: now + wait * 1000}, message),
  unreachable: stderr => new TrackerUnreachableError(stderr),
};
const config = mergeConfig({
  tracker: {kind: 'jira', ignore: ['wayfinder:*'], jira: {site: 'https://example.atlassian.net', project: 'ABC', effort: {field: 'customfield_10016', small_max: 2, medium_max: 5}}},
});
const tracker = config.tracker;

const issue = (n: number, fields: Record<string, unknown> = {}): JiraIssue => ({
  key: `ABC-${n}`,
  fields: {labels: ['ready-for-agent'], status: {statusCategory: {key: 'indeterminate'}}, ...fields},
});
const done = {statusCategory: {key: 'done'}};
const answer = (body: unknown, status = 200): CommandResult => ({exitCode: 0, stdout: `${JSON.stringify(body)}\n${status}`, stderr: ''});

describe('the Jira backlog', () => {
  test('the query names the project, leaves out the Done category, and tests the intake label unless a jql is configured', () => {
    expect(jiraQuery(tracker)).toBe('project = "ABC" AND statusCategory != Done AND labels = "ready-for-agent" ORDER BY key ASC');
    const withJql = mergeConfig({tracker: {kind: 'jira', jira: {site: 'https://x.net', project: 'ABC', jql: 'status = "Ready"'}}}).tracker;
    const q = jiraQuery(withJql);
    expect(q).toContain('project = "ABC" AND statusCategory != Done AND (status = "Ready")');
    expect(q).not.toContain('labels =');
    expect(searchCommand(tracker)).toContain('/rest/api/3/search/jql?jql=');
  });

  test('the search is read page by page until no next page token is left', () => {
    const commands: string[] = [];
    const pages = [answer({issues: [issue(1)], nextPageToken: 'tok2'}), answer({issues: [issue(2)], nextPageToken: 'tok3'}), answer({issues: [issue(3)]})];
    const data = readJiraBacklog(cmd => {
      commands.push(cmd);
      return pages[commands.length - 1] as CommandResult;
    }, tracker, errors);
    expect(Object.keys(data.features)).toEqual(['issue-1', 'issue-2', 'issue-3']);
    expect(commands).toHaveLength(3);
    expect(commands[0]).not.toContain('nextPageToken');
    expect(commands[1]).toContain('nextPageToken=tok2');
    expect(commands[2]).toContain('nextPageToken=tok3');
  });

  test('an issue becomes a ticket: the number of its key, the priority from a label or the map, the effort from a label or the field, its blockers from the links', () => {
    const data = backlogFromJiraIssues(
      [
        issue(7, {labels: ['ready-for-agent', 'P0', 'effort:large'], priority: {name: 'Low'}, customfield_10016: 1}),
        issue(8, {priority: {name: 'High'}, customfield_10016: 3, issuelinks: [
          {type: {name: 'Blocks'}, inwardIssue: {key: 'ABC-7'}},
          {type: {name: 'Blocks'}, outwardIssue: {key: 'ABC-99'}},
          {type: {name: 'Relates'}, inwardIssue: {key: 'ABC-50'}},
          {type: {name: 'Blocks'}, inwardIssue: {key: 'ABC-6', fields: {status: done}}},
        ]}),
        issue(9, {customfield_10016: 9}),
        issue(10, {customfield_10016: 2}),
      ],
      tracker
    );
    expect(data.features['issue-7']).toMatchObject({issue: 7, priority: 'P0', effort: 'large', status: 'not_started'});
    expect(data.features['issue-8']).toMatchObject({priority: 'P1', effort: 'medium', depends_on: ['issue-7', 'issue-6']});
    expect(data.features['issue-9']).toMatchObject({effort: 'large'});
    expect(data.features['issue-10']).toMatchObject({effort: 'small'});
    expect(data.features['issue-6']).toEqual({status: 'completed', issue: 6});
  });

  test('an issue in the Done category or with the merged label is completed, and the hold labels keep their statuses', () => {
    const status = (labels: string[], s?: unknown) =>
      (backlogFromJiraIssues([issue(1, {labels: ['ready-for-agent', ...labels], ...(s ? {status: s} : {})})], tracker).features['issue-1'] as {status: string}).status;
    expect(status([], done)).toBe('completed');
    expect(status(['merged'])).toBe('completed');
    expect(status(['owner-review'])).toBe('owner_review');
    expect(status(['needs-human'])).toBe('needs_human');
    expect(status(['needs-info'])).toBe('needs_info');
    expect(status(['deferred'])).toBe('deferred');
    expect(status(['wayfinder:map'])).toBe('untracked');
  });

  test('a ticket body comes from the description, and the backlog picks the ticket', () => {
    const description = {type: 'doc', version: 1, content: [{type: 'paragraph', content: [{type: 'text', text: 'Do the thing'}]}]};
    const backlog = jiraBacklog(() => answer({issues: [issue(4, {description})]}), config, errors);
    expect(backlog.next()).toBe('issue-4');
    expect(backlog.body('issue-4')).toBe('Do the thing');
  });
});

describe('a Jira failure', () => {
  test('a call limit is a rate limit error with its wait, no answer is an unreachable tracker, and a refused credential names the variables', () => {
    const limited = jiraFailure(errors, 0, '\n429', 'HTTP/2 429\nRetry-After: 90\n', 1_000_000);
    expect(limited).toBeInstanceOf(RateLimitError);
    expect((limited as RateLimitError).window?.resetAt).toBe(1_000_000 + 90_000);
    expect(jiraFailure(errors, 7, '', 'curl: (7) Failed to connect', 0)).toBeInstanceOf(TrackerUnreachableError);
    expect(jiraFailure(errors, 0, 'no status', '', 0)).toBeInstanceOf(TrackerUnreachableError);
    const refused = jiraFailure(errors, 0, '{}\n401', '', 0) as Error;
    expect(refused.message).toContain('JIRA_EMAIL');
    expect(refused.message).toContain('JIRA_API_TOKEN');
    expect(jiraFailure(errors, 0, '{}\n200', '', 0)).toBeNull();
  });

  test('an unreadable page throws and is never an empty backlog', () => {
    expect(() => readJiraBacklog(() => answer('x'.repeat(1)), tracker, errors)).toThrow(/no issues/);
    expect(() => readJiraBacklog(() => ({exitCode: 0, stdout: 'nope\n200', stderr: ''}), tracker, errors)).toThrow(/not JSON/);
  });
});
