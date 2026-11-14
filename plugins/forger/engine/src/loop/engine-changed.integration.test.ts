import {afterEach, describe, expect, test} from 'bun:test';
import {execSync} from 'child_process';
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {changedPaths, engineChangedMessage, engineChanges} from './engine-changed';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

const sh = (cmd: string): string => execSync(cmd, {encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe']});

function repo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-engine-')));
  dirs.push(root);
  sh(`git -C ${root} init -q`);
  mkdirSync(join(root, 'plugin'));
  writeFileSync(join(root, 'plugin', 'a.ts'), 'a\n');
  writeFileSync(join(root, '.gitignore'), 'plugin/node_modules/\n');
  sh(`git -C ${root} add -A && git -C ${root} -c user.name=t -c user.email=t@t commit -q -m init`);
  return root;
}

describe('engineChanges', () => {
  test('a clean engine has no changes', () => {
    expect(engineChanges(sh, join(repo(), 'plugin'))).toEqual([]);
  });

  test('a changed tracked file and a new unignored file are listed', () => {
    const root = repo();
    writeFileSync(join(root, 'plugin', 'a.ts'), 'changed\n');
    writeFileSync(join(root, 'plugin', 'b.ts'), 'new\n');
    expect(engineChanges(sh, join(root, 'plugin')).sort()).toEqual(['plugin/a.ts', 'plugin/b.ts']);
  });

  test('an ignored file under the engine\'s root does not count as a change', () => {
    const root = repo();
    mkdirSync(join(root, 'plugin', 'node_modules'));
    writeFileSync(join(root, 'plugin', 'node_modules', 'x.js'), 'x\n');
    expect(engineChanges(sh, join(root, 'plugin'))).toEqual([]);
  });

  test('a change outside the engine\'s root does not count', () => {
    const root = repo();
    writeFileSync(join(root, 'other.txt'), 'x\n');
    expect(engineChanges(sh, join(root, 'plugin'))).toEqual([]);
  });

  test('an engine that is not in a git work tree is not checked', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'forger-nogit-')));
    dirs.push(dir);
    writeFileSync(join(dir, 'a.ts'), 'x\n');
    expect(engineChanges(sh, dir)).toEqual([]);
  });
});

describe('changedPaths', () => {
  test('lists the new path of a rename and unquotes paths', () => {
    expect(changedPaths('R  old.ts -> new.ts\n?? "a b.ts"\n')).toEqual(['new.ts', 'a b.ts']);
  });
});

test('the refusal names the paths and says the verdict does not count', () => {
  const text = engineChangedMessage('verify', ['a.ts', 'b.ts']);
  expect(text).toContain('a.ts, b.ts');
  expect(text).toContain('does not count');
});
