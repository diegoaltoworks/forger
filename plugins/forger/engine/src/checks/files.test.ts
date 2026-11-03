import {describe, expect, test} from 'bun:test';

import {projectFiles} from './files';

describe('projectFiles', () => {
  test('tracked and untracked, once each, ignored files left out by git', () => {
    const run = (cmd: string) =>
      cmd === 'git ls-files' ? 'a.ts\nb.md' : cmd === 'git ls-files --others --exclude-standard' ? 'new.ts\na.ts\n' : 'ignored.ts';
    expect(projectFiles(run)).toEqual(['a.ts', 'b.md', 'new.ts']);
  });

  test('an empty repo has no files', () => expect(projectFiles(() => '')).toEqual([]));
});
