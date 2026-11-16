import {describe, expect, test} from 'bun:test';

import {declineRelabelProblems, ensureLabels, listIssueLabels, listRepoLabels, loopLabels, missingLabels} from './labels';
import {leaveQueue} from './decline-io';
import type {DeclineRecord} from './decline';
import {githubTracker} from '../tracker';

/** A fake GitHub: repository labels, one issue's labels, and an `add-label` that refuses unknown labels like gh does. */
export function fakeGithub(repoLabels: string[], issueLabels: string[]) {
  const repo = new Set(repoLabels);
  const issue = new Set(issueLabels);
  const calls: string[] = [];
  const run = (cmd: string): string => {
    calls.push(cmd);
    if (cmd.startsWith('gh label list')) return [...repo].join('\n');
    const create = /^gh label create '([^']+)'/.exec(cmd);
    if (create) {
      repo.add(create[1]);
      return '';
    }
    if (cmd.startsWith('gh issue view')) return [...issue].join('\n');
    const edit = /^gh issue edit \d+ --add-label '([^']+)' --remove-label '([^']+)'/.exec(cmd);
    if (edit) {
      if (!repo.has(edit[1])) throw new Error(`'${edit[1]}' not found`);
      issue.delete(edit[2]);
      issue.add(edit[1]);
    }
    return '';
  };
  return {run, calls, repo, issue};
}

const record: DeclineRecord = {ticket: 'issue-7', reason: 'blocked', detail: 'needs a key', at: 't'};
const target = {intakeLabel: 'ready-for-agent', backlogFile: ''};

describe('loopLabels', () => {
  test('declares the intake label, the status labels, priorities and efforts once', () => {
    const names = loopLabels('go').map(l => l.name);
    expect(names).toEqual(expect.arrayContaining(['go', 'needs-info', 'needs-human', 'deferred', 'needs-triage', 'P0', 'P3', 'effort:small', 'effort:large']));
    expect(new Set(names).size).toBe(names.length);
  });
  test('missingLabels ignores case', () => {
    expect(missingLabels(loopLabels('go'), loopLabels('go').map(l => l.name.toUpperCase()))).toEqual([]);
  });
});

describe('ensureLabels', () => {
  test('creates the missing labels, then creates nothing on a second run', () => {
    const gh = fakeGithub(['go', 'P0'], []);
    const first = ensureLabels(githubTracker(gh.run), 'go');
    expect(first).toContain('needs-info');
    expect(first).not.toContain('go');
    expect(ensureLabels(githubTracker(gh.run), 'go')).toEqual([]);
  });
});

describe('declineRelabelProblems', () => {
  test('names each label that did not change', () => {
    expect(declineRelabelProblems(['ready-for-agent'], 'ready-for-agent')).toEqual([
      'label "needs-info" was not added',
      'label "ready-for-agent" was not removed',
    ]);
    expect(declineRelabelProblems(['needs-info'], 'ready-for-agent')).toEqual([]);
  });
});

describe('the loop labels through the tracker', () => {
  test("the loop's labels are read and created through the tracker", () => {
    const gh = fakeGithub(['go'], ['go', 'needs-human']);
    const tracker = githubTracker(gh.run);
    expect(listRepoLabels(tracker)).toEqual(['go']);
    expect(listIssueLabels(tracker, 4)).toEqual(['go', 'needs-human']);
    expect(ensureLabels(tracker, 'go')).toContain('needs-info');
    expect(gh.calls).toContain('gh label list --limit 1000 --json name --jq ".[].name"');
    expect(gh.calls).toContain('gh issue view 4 --json labels --jq ".labels[].name"');
    expect(gh.calls.some(c => c.startsWith("gh label create 'needs-info' --color fbca04"))).toBe(true);
    expect([...gh.repo]).toContain('needs-info');
  });
});

describe('leaveQueue verifies its relabel', () => {
  test('fails and names the label when adding it fails', () => {
    const gh = fakeGithub(['ready-for-agent'], ['ready-for-agent']);
    expect(() => leaveQueue(githubTracker(gh.run), target, record)).toThrow();
  });
  test('fails and names the label when the read-back disagrees', () => {
    const run = (cmd: string): string => (cmd.startsWith('gh issue view') ? 'ready-for-agent' : '');
    expect(() => leaveQueue(githubTracker(run), target, record)).toThrow('needs-info');
  });
  test('succeeds once the label exists', () => {
    const gh = fakeGithub(['ready-for-agent', 'needs-info'], ['ready-for-agent']);
    expect(leaveQueue(githubTracker(gh.run), target, record)).toBe('issue #7 relabelled needs-info');
  });
});
