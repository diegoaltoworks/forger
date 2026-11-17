import {describe, expect, test} from 'bun:test';

import {mergeConfig} from './config';
import {backlogReader, publishesVerifyStatus, queueHome, ticketNaming} from './tracker-questions';

const of = (kind: 'github' | 'local' | 'none') => mergeConfig({tracker: {kind}});

describe('the tracker kind', () => {
  test('each question about the tracker kind answers for github, local and none', () => {
    expect(['github', 'local', 'none'].map(k => queueHome(of(k as 'github')))).toEqual(['tracker', 'file', 'file']);
    expect(['github', 'local', 'none'].map(k => publishesVerifyStatus(of(k as 'github')))).toEqual([true, false, false]);
    expect(['github', 'local', 'none'].map(k => ticketNaming(of(k as 'github')))).toEqual(['closing-reference', 'backlog-id', 'backlog-id']);
  });
});

describe('the kind jira', () => {
  test('every question about the tracker kind answers for jira', () => {
    const config = mergeConfig({tracker: {kind: 'jira', jira: {site: 'https://x.net', project: 'ABC'}}});
    expect(queueHome(config)).toBe('tracker');
    expect(publishesVerifyStatus(config)).toBe(true);
    expect(ticketNaming(config)).toBe('key-in-title');
    expect(backlogReader(config)).toBe('jira');
  });
});
