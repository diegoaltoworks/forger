import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {dirname, join} from 'path';

import {claudeHarness, codexHarness} from '../../adapters';
import {commandFilePaths} from '../../packs';
import type {CommandRunner} from '../../ports';
import {commandsProblems, formatUntrackedCommands} from './rules';
import {commandFileFacts, runCommandsCheck} from './git-facts';

const pluginRoot = join(import.meta.dir, '..', '..', '..', '..');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

describe('commandsProblems', () => {
  test('a command file that is missing, ignored or untracked is each named as a problem with what to do', () => {
    const problems = commandsProblems([
      {path: 'a/SKILL.md', state: 'missing'},
      {path: 'b/SKILL.md', state: 'ignored'},
      {path: 'c/SKILL.md', state: 'untracked'},
      {path: 'd/SKILL.md', state: 'tracked'}
    ]);
    expect(problems.map(p => [p.file, p.rule])).toEqual([
      ['a/SKILL.md', 'command-missing'],
      ['b/SKILL.md', 'command-ignored'],
      ['c/SKILL.md', 'command-untracked']
    ]);
    expect(problems[0].detail).toContain('work.ts setup');
    expect(problems[1].detail).toContain('ignore rules');
    expect(problems[1].detail).toContain('git add b/SKILL.md');
    expect(problems[2].detail).toContain('git add c/SKILL.md');
  });

  test('a harness with no command files has no problem', () => {
    expect(commandsProblems([])).toEqual([]);
  });
});

describe('formatUntrackedCommands', () => {
  test('names the ignored and untracked files and says a worker will not have them', () => {
    const lines = formatUntrackedCommands([
      {path: 'a', state: 'ignored'},
      {path: 'b', state: 'untracked'},
      {path: 'c', state: 'tracked'}
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('git ignores a');
    expect(lines[1]).toContain('git does not track b');
    expect(lines[1]).toContain('base branch');
  });
});

describe('runCommandsCheck', () => {
  function repo(files: string[] = []): string {
    const root = mkdtempSync(join(tmpdir(), 'forger-commands-'));
    dirs.push(root);
    for (const p of files) {
      mkdirSync(dirname(join(root, p)), {recursive: true});
      writeFileSync(join(root, p), 'x');
    }
    return root;
  }
  const gitSays = (tracked: string[], ignored: string[]): CommandRunner => cmd => {
    if (cmd.startsWith('git ls-files')) return tracked.join('\n');
    if (cmd.startsWith('git check-ignore')) {
      if (ignored.length === 0) throw new Error('exit 1');
      return ignored.join('\n');
    }
    return '';
  };

  test('a harness that loads the plugin for the session has no commands problem and asks git nothing', () => {
    const calls: string[] = [];
    const run: CommandRunner = cmd => {
      calls.push(cmd);
      return '';
    };
    const paths = commandFilePaths(pluginRoot, claudeHarness);
    expect(paths).toEqual([]);
    expect(runCommandsCheck(repo(), paths, run)).toEqual([]);
    expect(calls).toEqual([]);
  });

  test('each state is read from the disk and from git', () => {
    const paths = commandFilePaths(pluginRoot, codexHarness);
    expect(paths.length).toBeGreaterThan(3);
    const root = repo(paths.slice(0, 3));
    const facts = commandFileFacts(root, paths, gitSays([paths[0]], [paths[1]]));
    expect(facts.slice(0, 4).map(f => f.state)).toEqual(['tracked', 'ignored', 'untracked', 'missing']);
  });
});
