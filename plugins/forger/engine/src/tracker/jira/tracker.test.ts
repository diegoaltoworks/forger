import {describe, expect, test} from 'bun:test';

import {mergeConfig} from '../../config';
import type {CapturingRunner} from '../../ports';
import {StatusIssueHalt} from '../../loop';
import {EMAIL_VARIABLE, TOKEN_VARIABLE} from './call';
import {jiraTracker, numberOfKey} from './tracker';
import {openTracker} from '../open';

const base = {kind: 'jira' as const, jira: {site: 'https://example.invalid', project: 'ABC'}};
const config = (extra: Record<string, unknown> = {}) => mergeConfig({tracker: {...base, jira: {...base.jira, ...extra}} as never}).tracker;

const adf = (text: string) => ({type: 'doc', version: 1, content: [{type: 'paragraph', content: [{type: 'text', text}]}]});

type Rule = [RegExp, unknown, number?];

function fake(rules: Rule[], seen: string[] = []): CapturingRunner {
  return cmd => {
    seen.push(cmd);
    for (const [re, body, status = 200] of rules) {
      if (re.test(cmd)) return {stdout: `${typeof body === 'string' ? body : JSON.stringify(body)}\n${status}`, stderr: '', exitCode: 0};
    }
    return {stdout: '', stderr: `unexpected: ${cmd}`, exitCode: 1};
  };
}

const issue = (key: string, fields: Record<string, unknown> = {}) => ({key, fields: {summary: `title ${key}`, description: adf(`text of ${key}`), labels: ['P1'], status: {statusCategory: {key: 'indeterminate'}}, ...fields}});

describe('the Jira tracker', () => {
  test('the Jira tracker reads a ticket: its text as markdown, its labels, its last comment, and whether it exists', () => {
    const t = jiraTracker(
      fake([
        [/issue\/ABC-7\/comment/, {comments: [{body: adf('the last')}]}],
        [/issue\/ABC-7\?fields=summary'/, {key: 'ABC-7'}],
        [/issue\/ABC-8/, 'not found', 404],
        [/issue\/ABC-7/, issue('ABC-7')],
      ]),
      config()
    );
    expect(t.text(7)).toBe('text of ABC-7');
    expect(t.text(7, {whole: true}).stdout).toBe('text of ABC-7');
    expect(t.facts(7)).toEqual({labels: ['P1'], body: 'text of ABC-7'});
    expect(t.labels(7)).toEqual(['P1']);
    expect(t.lastComment(7)).toBe('the last');
    expect(t.exists(7)).toBe(true);
    expect(t.exists(8)).toBe(false);
    expect(() => t.text(8)).toThrow(/404/);
  });

  test("a ticket's state is closed when its status category is Done", () => {
    const done = issue('ABC-1', {status: {statusCategory: {key: 'done'}}});
    const t = jiraTracker(fake([[/issue\/ABC-1/, done], [/issue\/ABC-2/, issue('ABC-2')]]), config());
    expect(t.state(1)).toEqual({state: 'CLOSED', closedBy: []});
    expect(t.state(2)).toEqual({state: 'OPEN', closedBy: []});
    const facts = jiraTracker(fake([[/search\/jql/, {issues: [done, issue('ABC-2')]}]]), config()).ticketFacts([1, 2]);
    expect(facts.get(1)).toEqual({closed: true, mergedPr: null});
    expect(facts.get(2)).toEqual({closed: false, mergedPr: null});
  });

  test("a ticket's links name its key and its blockers of the configured link type", () => {
    const links = [
      {type: {name: 'Blocks'}, inwardIssue: {key: 'ABC-3'}},
      {type: {name: 'Relates'}, inwardIssue: {key: 'ABC-4'}},
      {type: {name: 'Blocks'}, outwardIssue: {key: 'ABC-5'}},
    ];
    const t = jiraTracker(fake([[/issue\/ABC-9/, issue('ABC-9', {issuelinks: links})], [/search\/jql/, {issues: [issue('ABC-9', {issuelinks: links})]}]]), config());
    expect(t.links(9)).toEqual({ref: 'ABC-9', body: 'text of ABC-9', native: [3]});
    expect(t.openTickets('ready')).toEqual([{number: 9, body: 'text of ABC-9', native: [3]}]);
    expect(t.links(10)).toBeNull();
    expect(numberOfKey('ABC-12')).toBe(12);
  });

  test('each write becomes one call: file, comment, body, labels, block', () => {
    const seen: string[] = [];
    const t = jiraTracker(fake([[/rest\/api\/3\/issue'/, {key: 'ABC-40'}, 201], [/./, '']], seen), config());
    expect(t.apply({kind: 'file', title: 'T', body: 'b', labels: ['x']})).toBe('https://example.invalid/browse/ABC-40');
    t.apply({kind: 'comment', ticket: 3, body: 'c'});
    t.apply({kind: 'body', ticket: 3, body: 'new'});
    t.apply({kind: 'labels', ticket: 3, add: ['a'], remove: ['r']});
    t.apply({kind: 'block', blocked: 'ABC-3', blocker: 'ABC-2'});
    expect(seen).toHaveLength(5);
    expect(seen[0]).toContain('-X POST');
    expect(seen[1]).toContain('/rest/api/3/issue/ABC-3/comment');
    expect(seen[2]).toContain('-X PUT');
    expect(seen[3]).toContain('{"update":{"labels":[{"add":"a"},{"remove":"r"}]}}');
    expect(seen[4]).toContain('/rest/api/3/issueLink');
    expect(seen[4]).toContain('"inwardIssue":{"key":"ABC-3"},"outwardIssue":{"key":"ABC-2"}');
    expect(() => t.apply({kind: 'comment', ticket: 3, body: 'c'}, {whole: true})).not.toThrow();
  });

  test("a filed ticket's text and a comment are sent as a document converted from markdown", () => {
    const seen: string[] = [];
    const t = jiraTracker(fake([[/./, {key: 'ABC-1'}]], seen), config());
    t.apply({kind: 'file', title: 'T', body: '## Head\n\n- one', labels: []});
    t.apply({kind: 'comment', ticket: 1, body: 'see `x`'});
    expect(seen[0]).toContain('"type":"doc"');
    expect(seen[0]).toContain('"type":"heading"');
    expect(seen[0]).toContain('"type":"bulletList"');
    expect(seen[1]).toContain('"marks":[{"type":"code"}]');
  });

  test('createLabel and pin make no call and succeed', () => {
    const seen: string[] = [];
    const t = jiraTracker(fake([], seen), config());
    expect(t.apply({kind: 'pin', ticket: 1})).toBe('');
    expect(t.apply({kind: 'createLabel', name: 'n', color: 'fff', description: 'd'}, {whole: true}).exitCode).toBe(0);
    expect(seen).toEqual([]);
  });

  test('the commands name the credential variables and never their values', () => {
    process.env[TOKEN_VARIABLE] = 'secret-token-value';
    process.env[EMAIL_VARIABLE] = 'someone@example.invalid';
    const seen: string[] = [];
    const t = jiraTracker(fake([[/./, issue('ABC-1')]], seen), config());
    t.text(1);
    t.apply({kind: 'comment', ticket: 1, body: 'c'});
    delete process.env[TOKEN_VARIABLE];
    delete process.env[EMAIL_VARIABLE];
    for (const c of seen) {
      expect(c).toContain(`$${TOKEN_VARIABLE}`);
      expect(c).not.toContain('secret-token-value');
      expect(c).not.toContain('someone@example.invalid');
    }
  });

  test('openTracker gives the Jira tracker for the kind jira', () => {
    const seen: string[] = [];
    const t = openTracker({tracker: config()}, () => '', fake([[/./, issue('ABC-1')]], seen));
    expect(t.text(1)).toBe('text of ABC-1');
    expect(seen[0]).toContain('example.invalid');
  });
});

const transitions = {transitions: [{id: '11', name: 'Start', to: {name: 'In Progress'}}, {id: '31', name: 'Close it', to: {name: 'Done'}}]};

describe('the status moves', () => {
  test('a status move is made only when its status is configured, through the transition that leads to it', () => {
    const seen: string[] = [];
    const t = jiraTracker(fake([[/transitions/, transitions], [/./, '', 204]], seen), config({statuses: {started: 'in progress'}}));
    expect(t.moveStatus(5, 'started')).toEqual([]);
    expect(seen[1]).toContain('-X POST');
    expect(seen[1]).toContain('{"transition":{"id":"11"}}');
    seen.length = 0;
    expect(t.moveStatus(5, 'review')).toEqual([]);
    expect(seen).toEqual([]);
  });

  test('a status with no transition to it is logged and the run goes on', () => {
    const logged: string[] = [];
    const seen: string[] = [];
    const t = jiraTracker(fake([[/transitions/, transitions]], seen), config({statuses: {review: 'In Review'}}), l => logged.push(l));
    const lines = t.moveStatus(5, 'review');
    expect(lines).toHaveLength(1);
    expect(logged).toEqual(lines);
    expect(lines[0]).toContain('ABC-5');
    expect(lines[0]).toContain('In Review');
    expect(seen).toHaveLength(1);
  });

  test("a merge with no done status comments the pull request's address and replaces the intake label with merged", () => {
    const seen: string[] = [];
    const t = jiraTracker(fake([[/./, '', 204]], seen), config());
    expect(t.moveStatus(5, 'done', 'https://host.invalid/pr/9')).toEqual([]);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain('/issue/ABC-5/comment');
    expect(seen[0]).toContain('https://host.invalid/pr/9');
    expect(seen[1]).toContain('{"add":"merged"},{"remove":"ready-for-agent"}');
  });

  test('a done status moves the issue and writes nothing else', () => {
    const seen: string[] = [];
    const t = jiraTracker(fake([[/transitions/, transitions], [/./, '', 204]], seen), config({statuses: {done: 'Done'}}));
    t.moveStatus(5, 'done', 'https://host.invalid/pr/9');
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain('{"transition":{"id":"31"}}');
  });

  test('a failed move is a line and never a throw', () => {
    const t = jiraTracker(fake([[/./, 'down', 500]]), config({statuses: {started: 'In Progress'}}));
    expect(t.moveStatus(5, 'started')[0]).toContain('move failed');
  });

  test('with the tracker on GitHub no status is moved and nothing is commented', () => {
    const seen: string[] = [];
    const t = openTracker({tracker: mergeConfig({tracker: {kind: 'github'}}).tracker}, cmd => (seen.push(cmd), ''));
    expect(t.moveStatus(5, 'started')).toEqual([]);
    expect(t.moveStatus(5, 'done', 'https://host.invalid/pr/9')).toEqual([]);
    expect(seen).toEqual([]);
  });
});

describe('the status issue', () => {
  test('the status issue of a Jira project is found by its title, created when missing, and its halted label halts the loop', () => {
    const seen: string[] = [];
    const found = jiraTracker(
      fake([
        [/search\/jql/, {issues: [issue('ABC-30', {summary: 'Forger loop', labels: ['halted']})]}],
        [/issue\/ABC-30\/comment/, {comments: [{body: adf('why')}]}],
        [/issue\/ABC-30/, issue('ABC-30', {labels: ['halted']})],
      ], seen),
      config()
    );
    expect(new StatusIssueHalt(found).read()).toEqual({label: true, reason: 'why'});
    expect(seen[0]).toContain(encodeURIComponent('summary ~ "Forger loop"'));

    const made: string[] = [];
    const missing = jiraTracker(fake([[/search\/jql/, {issues: []}], [/rest\/api\/3\/issue'/, {key: 'ABC-31'}, 201], [/./, '', 204]], made), config());
    new StatusIssueHalt(missing).set('stop');
    expect(made.some(c => c.includes('"summary":"Forger loop"'))).toBe(true);
    expect(made.some(c => c.includes('/issue/ABC-31/comment'))).toBe(true);
    expect(made.some(c => c.includes('{"add":"halted"}'))).toBe(true);
  });
});
