import {describe, expect, test} from 'bun:test';

import {mergeConfig} from '../config';
import {capturing, type CommandRunner, type TrackerWrite} from '../ports';
import {githubCommand} from './github-command';
import {filedLabels} from './filed-labels';
import {blockCommand, factsCommand, openTicketsCommand, ticketLinksCommand} from './github-graphql';
import {githubTracker} from './github-tracker';
import {openTracker} from './open';

describe('githubCommand', () => {
  test('gives the gh command for each kind of write', () => {
    const cases: Array<[TrackerWrite, string]> = [
      [{kind: 'file', title: "it's", body: 'b', labels: ['a', 'b c']}, "gh issue create --title 'it'\\''s' --body 'b' --label 'a' --label 'b c'"],
      [{kind: 'comment', ticket: 4, body: 'hi'}, "gh issue comment 4 --body 'hi'"],
      [{kind: 'labels', ticket: 4, add: ['x'], remove: ['y', 'z']}, "gh issue edit 4 --add-label 'x' --remove-label 'y' --remove-label 'z'"],
      [{kind: 'body', ticket: 4, body: 'new'}, "gh issue edit 4 --body 'new'"],
      [{kind: 'pin', ticket: 4}, 'gh issue pin 4'],
      [{kind: 'createLabel', name: 'n', color: 'fff', description: 'd'}, "gh label create 'n' --color fff --description 'd'"],
    ];
    for (const [write, command] of cases) expect(githubCommand(write)).toBe(command);
    expect(() => githubCommand({kind: 'labels', ticket: 1, add: [], remove: []})).toThrow();
  });
});

function fake(answers: Record<string, string>, seen: string[] = []): CommandRunner {
  return cmd => {
    seen.push(cmd);
    if (!(cmd in answers)) throw new Error(`unexpected: ${cmd}`);
    return answers[cmd];
  };
}

describe('the GitHub tracker', () => {
  test("reads a ticket's text with the command check ticket runs today", () => {
    const seen: string[] = [];
    const t = githubTracker(fake({'gh issue view 42 --json body --jq .body': 'text'}, seen));
    expect(t.text(42)).toBe('text');
    expect(seen).toEqual(['gh issue view 42 --json body --jq .body']);
  });

  test("reads a ticket's labels and its text", () => {
    const t = githubTracker(
      fake({
        'gh issue view 7 --json labels,body': JSON.stringify({labels: [{name: 'P1'}, {name: 'bug'}], body: 'b'}),
        'gh issue view 7 --json labels --jq ".labels[].name"': 'P1\nbug\n',
        'gh issue view 7 --json state,closedByPullRequestsReferences': JSON.stringify({state: 'CLOSED', closedByPullRequestsReferences: [{number: 9}]}),
        'gh issue view 7 --json comments --jq ".comments[-1].body // empty"': 'last\n',
        'gh issue view 7 --json number': '{}',
        'gh issue list --state open --label \'q\' --search \'"t" in:title\' --limit 5 --json number,title': '[{"number":1,"title":"t"}]',
        'gh label list --limit 1000 --json name --jq ".[].name"': 'a\nb\n',
      })
    );
    expect(t.facts(7)).toEqual({labels: ['P1', 'bug'], body: 'b'});
    expect(t.labels(7)).toEqual(['P1', 'bug']);
    expect(t.state(7)).toEqual({state: 'CLOSED', closedBy: [9]});
    expect(t.lastComment(7)).toBe('last');
    expect(t.exists(7)).toBe(true);
    expect(t.list({state: 'open', label: 'q', title: 't', limit: 5})).toEqual([{number: 1, title: 't'}]);
    expect(t.repoLabels()).toEqual(['a', 'b']);
  });

  test('a write runs its command through the runner and returns the answer', () => {
    const seen: string[] = [];
    const t = githubTracker(fake({"gh issue create --title 'T' --body 'B'": 'https://example/issues/3'}, seen));
    expect(t.apply({kind: 'file', title: 'T', body: 'B', labels: []})).toBe('https://example/issues/3');
    expect(seen).toEqual(["gh issue create --title 'T' --body 'B'"]);
  });

  test('runs a call through the plain runner unless the caller asks for the whole result', () => {
    const failing: CommandRunner = () => {
      throw new Error('gh failed');
    };
    const t = githubTracker(failing);
    expect(() => t.text(1)).toThrow('gh failed');
    expect(t.text(1, {whole: true})).toEqual({stdout: '', stderr: 'gh failed', exitCode: 1});
    expect(t.exists(1)).toBe(false);
    const own = githubTracker(failing, () => ({stdout: 'x', stderr: '', exitCode: 0}));
    expect(own.text(1, {whole: true}).stdout).toBe('x');
    expect(capturing(failing)('x').exitCode).toBe(1);
  });
});

describe('openTracker', () => {
  const run: CommandRunner = () => 'ok';
  test('gives the GitHub tracker for github, local and none', () => {
    for (const kind of ['github', 'local', 'none'] as const) {
      expect(openTracker({tracker: {kind, label: 'l', ignore: []}}, run).text(1)).toBe('ok');
    }
  });

  test('the queue is in the tracker for github and in a file for local and none', () => {
    const queue = (kind: 'github' | 'local' | 'none') => openTracker({tracker: {kind, label: 'l', ignore: []}}, run).queue;
    expect([queue('github'), queue('local'), queue('none')]).toEqual(['tracker', 'file', 'file']);
  });
});

describe('what the engine files', () => {
  test('the GitHub tracker lists tickets by state, label and title with one command', () => {
    const seen: string[] = [];
    const t = githubTracker(fake({"gh issue list --state open --label 'x' --search '\"A b\" in:title' --json number,title": '[{"number":3,"title":"A b"}]'}, seen));
    expect(t.list({state: 'open', label: 'x', title: 'A b'})).toEqual([{number: 3, title: 'A b'}]);
    expect(seen).toHaveLength(1);
  });

  test('the GitHub tracker lists tickets with their number, title, labels and text', () => {
    const seen: string[] = [];
    const t = githubTracker(fake({"gh issue list --state all --label 'bug' --limit 50 --json number,title,labels,body": '[{"number":4,"title":"T","labels":[{"name":"bug"}],"body":"B"},{"number":5,"title":"U","labels":[{"name":"bug"}]}]'}, seen));
    expect(t.tickets({state: 'all', label: 'bug', limit: 50})).toEqual([
      {number: 4, title: 'T', labels: ['bug'], body: 'B'},
      {number: 5, title: 'U', labels: ['bug'], body: ''},
    ]);
    expect(seen).toHaveLength(1);
  });

  test('the GitHub tracker says whether a ticket exists', () => {
    const t = githubTracker(fake({'gh issue view 3 --json number': '{}'}));
    expect(t.exists(3)).toBe(true);
    expect(t.exists(4)).toBe(false);
  });

  test("the GitHub tracker reads a ticket's state and the pull requests that close it", () => {
    const t = githubTracker(fake({'gh issue view 5 --json state,closedByPullRequestsReferences': '{"state":"OPEN","closedByPullRequestsReferences":[{"number":8},{"number":2}]}'}));
    expect(t.state(5)).toEqual({state: 'OPEN', closedBy: [8, 2]});
  });

  test('the GitHub tracker gives the command a person runs to list the tickets with a label', () => {
    expect(githubTracker(fake({})).listCommand('needs-info')).toBe('gh issue list --label needs-info');
  });

  test('a ticket the engine files carries the intake label only when the queue is in the tracker', () => {
    expect(filedLabels('tracker', 'ready', ['p'])).toEqual(['p', 'ready']);
    expect(filedLabels('file', 'ready', ['p'])).toEqual(['p']);
    expect(filedLabels('file', 'ready')).toEqual([]);
  });
});

describe('what the engine reads and links with a GraphQL query', () => {
  test('the GitHub tracker reads the open tickets with a label, their text and their blockers in one call', () => {
    const seen: string[] = [];
    const answer = JSON.stringify({data: {repository: {issues: {nodes: [{number: 3, body: 'b', blockedBy: {nodes: [{number: 1}]}}, {number: 4, body: null}]}}}});
    const t = githubTracker(fake({[openTicketsCommand('ready')]: answer}, seen));
    expect(t.openTickets('ready')).toEqual([
      {number: 3, body: 'b', native: [1]},
      {number: 4, body: '', native: []},
    ]);
    expect(seen).toHaveLength(1);
    expect(() => githubTracker(fake({})).openTickets('ready')).toThrow('unexpected');
  });

  test("the GitHub tracker reads a ticket's blockers and links one with the mutation", () => {
    const seen: string[] = [];
    const node = {data: {repository: {issue: {id: 'I7', body: 'x', blockedBy: {nodes: [{number: 2}]}}}}};
    const t = githubTracker(fake({[ticketLinksCommand(7)]: JSON.stringify(node), [ticketLinksCommand(8)]: '{"data":{"repository":{"issue":null}}}', [blockCommand('I7', 'I5')]: '{}'}, seen));
    expect(t.links(7)).toEqual({ref: 'I7', body: 'x', native: [2]});
    expect(t.links(8)).toBeNull();
    t.apply({kind: 'block', blocked: 'I7', blocker: 'I5'});
    expect(seen[2]).toContain("-f issue='I7' -f blocker='I5'");
    expect(seen[2]).toContain('addBlockedBy');
  });

  test('the GitHub tracker reads the facts of several tickets in one call', () => {
    const seen: string[] = [];
    const issue = (state: string, closer: unknown) => ({state, timelineItems: {nodes: [{closer}]}});
    const raw = JSON.stringify({data: {repository: {i5: issue('CLOSED', {__typename: 'PullRequest', number: 9, merged: true}), i6: issue('OPEN', null), i7: null}}});
    const t = githubTracker(fake({[factsCommand([5, 6, 7])]: raw}, seen));
    expect([...t.ticketFacts([5, 6, 7])]).toEqual([
      [5, {closed: true, mergedPr: 9}],
      [6, {closed: false, mergedPr: null}],
    ]);
    expect(seen).toHaveLength(1);
  });
});

describe('openTracker for jira', () => {
  test('opening the tracker for the kind jira says the reads and writes of a single ticket are not built', () => {
    const config = mergeConfig({tracker: {kind: 'jira', jira: {site: 'https://x.net', project: 'ABC'}}});
    expect(() => openTracker(config, () => '')).toThrow('the reads and writes of a single ticket are not built');
  });
});
