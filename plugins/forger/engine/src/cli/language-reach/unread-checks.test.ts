import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join, resolve} from 'path';

import {runSetup} from '../../packs';
import {formatUnread, unreadChecks} from './unread-checks';

const PLUGIN_ROOT = resolve(import.meta.dir, '../../../..');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function installed(files: Record<string, string>): {root: string; run: (cmd: string) => string} {
  const root = mkdtempSync(join(tmpdir(), 'forger-unread-'));
  dirs.push(root);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), {recursive: true});
    writeFileSync(join(root, name), body);
  }
  const run = (cmd: string) => (cmd === 'git ls-files' ? Object.keys(files).join('\n') : '');
  runSetup(root, PLUGIN_ROOT, {run});
  return {root, run};
}

describe('unreadChecks', () => {
  test('setup lists the checks that cannot read the repository\'s languages', () => {
    const {root, run} = installed({'app/a.py': 'import b', 'app/b.py': ''});
    const out = unreadChecks(root, PLUGIN_ROOT, run);
    expect(out).toContainEqual({check: 'structure', extensions: ['.py'], files: 2});
    expect(formatUnread(out).join('\n')).toContain('unread   structure cannot read imports in .py files');
  });

  test('a repository whose source is read lists nothing', () => {
    const {root, run} = installed({'a.ts': ''});
    expect(unreadChecks(root, PLUGIN_ROOT, run)).toEqual([]);
  });

  test('without a lock there is nothing installed to list', () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-unread-'));
    dirs.push(root);
    expect(unreadChecks(root, PLUGIN_ROOT, () => '')).toEqual([]);
  });
});
