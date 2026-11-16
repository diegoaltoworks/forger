import {describe, expect, test} from 'bun:test';

import {capturing, type CommandRunner, type TrackerWrite} from '../ports';
import {githubCommand} from './github-command';
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
