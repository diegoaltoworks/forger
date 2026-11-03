import {describe, expect, test} from 'bun:test';

import {declineRelabelProblems, ensureLabels, loopLabels, missingLabels} from './labels';
import {leaveQueue} from './decline-io';
import type {DeclineRecord} from './decline';

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
    const edit = /^gh issue edit \d+ --remove-label '([^']+)' --add-label (\S+)/.exec(cmd);
    if (edit) {
      if (!repo.has(edit[2])) throw new Error(`'${edit[2]}' not found`);
      issue.delete(edit[1]);
      issue.add(edit[2]);
    }
    return '';
  };
  return {run, calls, repo, issue};
}

const record: DeclineRecord = {ticket: 'issue-7', reason: 'blocked', detail: 'needs a key', at: 't'};
const target = {trackerKind: 'github' as const, intakeLabel: 'ready-for-agent', backlogFile: ''};

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
    const first = ensureLabels(gh.run, 'go');
    expect(first).toContain('needs-info');
    expect(first).not.toContain('go');
    expect(ensureLabels(gh.run, 'go')).toEqual([]);
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

describe('leaveQueue verifies its relabel', () => {
  test('fails and names the label when adding it fails', () => {
    const gh = fakeGithub(['ready-for-agent'], ['ready-for-agent']);
    expect(() => leaveQueue(gh.run, target, record)).toThrow();
  });
  test('fails and names the label when the read-back disagrees', () => {
    const run = (cmd: string): string => (cmd.startsWith('gh issue view') ? 'ready-for-agent' : '');
    expect(() => leaveQueue(run, target, record)).toThrow('needs-info');
  });
  test('succeeds once the label exists', () => {
    const gh = fakeGithub(['ready-for-agent', 'needs-info'], ['ready-for-agent']);
    expect(leaveQueue(gh.run, target, record)).toBe('issue #7 relabelled needs-info');
  });
});
