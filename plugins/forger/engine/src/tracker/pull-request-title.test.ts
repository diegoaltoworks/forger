import {describe, expect, test} from 'bun:test';

import {mergeConfig} from '../config';
import {pullRequestTitle, titleReader} from './pull-request-title';

const jira = mergeConfig({tracker: {kind: 'jira', jira: {site: 'https://x.net', project: 'ABC'}}});

describe('the title of a ticket\'s pull request', () => {
  test('the title of a Jira ticket\'s pull request begins with the key', () => {
    expect(pullRequestTitle(jira, 12, 'a thing')).toBe('ABC-12: a thing');
    expect(titleReader(jira)('ABC-12: a thing')).toBe(12);
  });

  test('the other kinds keep the feat form and read no ticket from a title', () => {
    for (const kind of ['github', 'local', 'none'] as const) {
      const config = mergeConfig({tracker: {kind}});
      expect(pullRequestTitle(config, 12, 'a thing')).toBe('feat: a thing');
      expect(titleReader(config)('ABC-12: a thing')).toBeNull();
    }
  });

  test('a key of another project, or one not at the start, names nothing', () => {
    const read = titleReader(jira);
    expect(read('XYZ-12: a thing')).toBeNull();
    expect(read('feat: ABC-12')).toBeNull();
    expect(read('ABC-12x')).toBeNull();
  });
});
