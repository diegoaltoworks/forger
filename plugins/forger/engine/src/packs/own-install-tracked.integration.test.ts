import {expect, test} from 'bun:test';
import {spawnSync} from 'child_process';
import {readFileSync} from 'fs';
import {join, resolve} from 'path';

import {LOCK_PATH, parseLock} from './packs';

const repo = resolve(import.meta.dir, '../../../../..');

test("every file this repository's lock names is tracked by git", () => {
  const lock = parseLock(readFileSync(join(repo, LOCK_PATH), 'utf8'));
  const tracked = new Set(
    spawnSync('git', ['ls-files', '-z'], {cwd: repo, encoding: 'utf8'})
      .stdout.split('\0')
      .filter(Boolean),
  );
  const untracked = lock.packs.flatMap(p => p.files.map(f => f.path)).filter(path => !tracked.has(path));
  expect(untracked, 'the lock names files git does not track: commit them, so a clone has them and setup writes nothing').toEqual([]);
});
