import {describe, expect, test} from 'bun:test';

import {mergeConfig} from '../config';
import {workerBacklogText, workerChangesText} from './worker-backlog';

describe('the worker text', () => {
  test("the worker's backlog text is given for github, local and none", () => {
    const text = (kind: 'github' | 'local' | 'none') => workerBacklogText(mergeConfig({tracker: {kind}}));
    expect(text('github')).toContain('## GitHub Issues are the backlog');
    expect(text('local')).toContain('Tracker is LOCAL');
    expect(text('none')).toContain('Tracker is NONE');
    expect(workerChangesText(mergeConfig({tracker: {kind: 'github'}}))).toBe('code, tests, docs');
    expect(workerChangesText(mergeConfig({tracker: {kind: 'none'}}))).toContain('backlog.json');
  });
});

describe('the kind jira', () => {
  test('the worker is told the project is the backlog and never to call Jira', () => {
    const config = mergeConfig({tracker: {kind: 'jira', jira: {site: 'https://x.net', project: 'ABC'}}});
    expect(workerBacklogText(config)).toContain('Never call Jira yourself');
    expect(workerChangesText(config)).toBe('code, tests, docs');
  });
});

describe('the kind jira, the key and the pull request', () => {
  test("the worker's text for jira names the key, work ticket, the title's key and no closing reference", () => {
    const text = workerBacklogText(mergeConfig({tracker: {kind: 'jira', jira: {site: 'https://x.net', project: 'ABC'}}}));
    expect(text).toContain('`ABC-<n>`');
    expect(text).toContain('`work ticket <n>`');
    expect(text).toContain('title begins with the key');
    expect(text).toContain('body carries no closing reference');
    expect(text).not.toContain('Closes #<issue>');
  });
});
