import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {runDecisionsCheck} from './decisions-check';
import {loadPacks} from '../../packs';
import type {CommandRunner} from '../../ports';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-decisions-'));
  dirs.push(root);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), {recursive: true});
    writeFileSync(join(root, name), body);
  }
  return root;
}

const pkg = (deps: Record<string, string>) => JSON.stringify({dependencies: deps}, null, 2);

/** Canned git: the merge-base, the name-status diff, untracked files and the base side of each manifest. */
function git(opts: {diff?: string; untracked?: string; base?: Record<string, string>; mergeBase?: string}): CommandRunner {
  return cmd => {
    if (cmd.startsWith('git merge-base')) return opts.mergeBase ?? 'abc123';
    if (cmd.startsWith('git diff')) return opts.diff ?? '';
    if (cmd.startsWith('git ls-files')) return opts.untracked ?? '';
    const shown = /^git show \S+:(.+)$/.exec(cmd);
    return shown ? (opts.base?.[shown[1]] ?? '') : '';
  };
}

describe('runDecisionsCheck', () => {
  test('a branch that adds a dependency and no ADR fails on the added line', () => {
    const root = repo({'package.json': pkg({a: '1', b: '2'})});
    const out = runDecisionsCheck(root, git({diff: 'M\tpackage.json', base: {'package.json': pkg({a: '1'})}}));
    expect(out.map(f => [f.file, f.line, f.rule])).toEqual([['package.json', 4, 'dependency-without-adr']]);
  });

  test('the same branch with an untracked ADR passes', () => {
    const root = repo({'package.json': pkg({a: '1', b: '2'})});
    const run = git({diff: 'M\tpackage.json', untracked: 'docs/adr/0009-b.md', base: {'package.json': pkg({a: '1'})}});
    expect(runDecisionsCheck(root, run)).toEqual([]);
  });

  test('a version bump alone passes', () => {
    const root = repo({'package.json': pkg({a: '2'})});
    expect(runDecisionsCheck(root, git({diff: 'M\tpackage.json', base: {'package.json': pkg({a: '1'})}}))).toEqual([]);
  });

  test('a new manifest counts every dependency as added', () => {
    const root = repo({'sub/package.json': pkg({a: '1'})});
    const out = runDecisionsCheck(root, git({diff: 'A\tsub/package.json'}));
    expect(out.map(f => f.file)).toEqual(['sub/package.json']);
  });

  test('a changed layer map with no ADR fails', () => {
    const root = repo({});
    const out = runDecisionsCheck(root, git({diff: 'M\t.claude/architecture.json'}));
    expect(out.map(f => f.rule)).toEqual(['layer-map-without-adr']);
  });

  test('an empty diff passes', () => {
    expect(runDecisionsCheck(repo({}), git({}))).toEqual([]);
  });

  test('an unresolvable base branch is an error, not a pass', () => {
    expect(() => runDecisionsCheck(repo({}), git({mergeBase: ''}))).toThrow('merge-base');
  });

  test('the base branch comes from the workloop config', () => {
    const root = repo({'.claude/workloop.config.json': JSON.stringify({base_branch: 'develop'})});
    const seen: string[] = [];
    runDecisionsCheck(root, cmd => (seen.push(cmd), cmd.startsWith('git merge-base') ? 'abc' : ''));
    expect(seen[0]).toBe('git merge-base develop HEAD');
  });
});

describe('the shipped architecture pack', () => {
  const pack = loadPacks(join(import.meta.dir, '..', '..', '..', '..')).find(p => p.manifest.id === 'architecture')!;

  test('declares the decisions opinion against the decisions check', () => {
    expect(pack.manifest.opinions.filter(o => o.check === 'decisions').map(o => o.id)).toEqual(['architecture.decisions-recorded']);
    expect(pack.manifest.checks).toContain('decisions');
  });

  test('installs an ADR template', () => {
    expect(pack.manifest.files.map(f => f.target)).toContain('.claude/templates/adr.md');
  });
});
