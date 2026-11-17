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
