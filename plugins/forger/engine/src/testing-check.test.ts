import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {CommandRunner} from './git';
import {runCoverageCheck, runTestsCheck, updateCoverageBaseline} from './testing-check';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

const CONFIG = JSON.stringify({
  test_paths: ['**/*.test.ts'],
  integration_paths: ['**/integration/**'],
  network_modules: ['http', 'child_process'],
  coverage_report: 'coverage/lcov.info',
  coverage_baseline: 'baseline.json',
});

function repo(files: Record<string, string>, config: string | null = CONFIG): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-testing-'));
  dirs.push(root);
  const all = config === null ? files : {'.claude/testing.json': config, ...files};
  for (const [name, body] of Object.entries(all)) {
    mkdirSync(join(root, name, '..'), {recursive: true});
    writeFileSync(join(root, name), body);
  }
  return root;
}

function git(opts: {subjects?: string[]; status?: string; untracked?: string; tracked?: string; mergeBase?: string}): CommandRunner {
  return cmd => {
    if (cmd.startsWith('git merge-base')) return opts.mergeBase ?? 'abc123';
    if (cmd.startsWith('git log')) return (opts.subjects ?? []).join('\n');
    if (cmd.startsWith('git diff --name-status')) return opts.status ?? '';
    if (cmd === 'git ls-files') return opts.tracked ?? '';
    if (cmd.startsWith('git ls-files')) return opts.untracked ?? '';
    return '';
  };
}

// Built from a variable so this file's own source never matches the rule it tests.
const importing = (m: string) => `import x from '${m}';\n`;

describe('runTestsCheck', () => {
  const files = {'src/a.ts': 'x', 'src/a.test.ts': 'y'};

  test('a fix with a test passes', () => {
    const root = repo(files);
    expect(runTestsCheck(root, git({subjects: ['fix: a'], status: 'M\tsrc/a.ts\nM\tsrc/a.test.ts', tracked: 'src/a.ts\nsrc/a.test.ts'}))).toEqual([]);
  });

  test('a fix without a test fails', () => {
    const root = repo(files);
    const found = runTestsCheck(root, git({subjects: ['fix: a'], status: 'M\tsrc/a.ts', tracked: 'src/a.ts\nsrc/a.test.ts'}));
    expect(found.map(f => f.opinion)).toEqual(['testing.fix-with-test']);
  });

  test('an untracked test file counts as a test change', () => {
    const root = repo(files);
    expect(runTestsCheck(root, git({subjects: ['fix: a'], status: 'M\tsrc/a.ts', untracked: 'src/a.test.ts'}))).toEqual([]);
  });

  test('a deleted test file is not a test change', () => {
    const root = repo({'src/a.ts': 'x'});
    const found = runTestsCheck(root, git({subjects: ['fix: a'], status: 'M\tsrc/a.ts\nD\tsrc/old.test.ts'}));
    expect(found).toHaveLength(1);
  });

  test('a feat branch needs no test here', () => {
    const root = repo(files);
    expect(runTestsCheck(root, git({subjects: ['feat: a'], status: 'M\tsrc/a.ts'}))).toEqual([]);
  });

  test('a unit test importing a process module is flagged with file and line', () => {
    const root = repo({'src/b.test.ts': importing('y') + importing('node:child_process')});
    const found = runTestsCheck(root, git({tracked: 'src/b.test.ts'}));
    expect(found.map(f => [f.file, f.line, f.opinion])).toEqual([['src/b.test.ts', 2, 'testing.no-network']]);
  });

  test('an integration test may import it', () => {
    const root = repo({'src/integration/b.test.ts': importing('http')});
    expect(runTestsCheck(root, git({tracked: 'src/integration/b.test.ts'}))).toEqual([]);
  });

  test('an unresolvable base is an error', () => {
    expect(() => runTestsCheck(repo(files), git({mergeBase: ''}))).toThrow('merge-base');
  });

  test('a missing config is an error', () => {
    expect(() => runTestsCheck(repo(files, null), git({}))).toThrow('.claude/testing.json not found');
  });
});

describe('coverage ratchet', () => {
  const lcov = (hit: number) => `SF:a.ts\nLF:100\nLH:${hit}\nend_of_record\n`;
  const noGit: CommandRunner = () => '';

  test('passes at the baseline and fails below it', () => {
    const root = repo({'coverage/lcov.info': lcov(80), 'baseline.json': '{"line_coverage":80}'});
    expect(runCoverageCheck(root, noGit)).toEqual([]);
    writeFileSync(join(root, 'coverage/lcov.info'), lcov(79));
    expect(runCoverageCheck(root, noGit).map(f => f.rule)).toEqual(['coverage-dropped']);
  });

  test('a missing baseline is a finding', () => {
    const root = repo({'coverage/lcov.info': lcov(80)});
    expect(runCoverageCheck(root, noGit).map(f => f.rule)).toEqual(['no-baseline']);
  });

  test('a missing report is an error', () => {
    const root = repo({'baseline.json': '{"line_coverage":80}'});
    expect(() => runCoverageCheck(root, noGit)).toThrow('coverage/lcov.info not found');
  });

  test('--update creates the baseline, raises it, and never lowers it', () => {
    const root = repo({'coverage/lcov.info': lcov(80)});
    const baseline = () => JSON.parse(readFileSync(join(root, 'baseline.json'), 'utf-8')).line_coverage;
    expect(updateCoverageBaseline(root)).toBe(8000);
    expect(baseline()).toBe(80);
    writeFileSync(join(root, 'coverage/lcov.info'), lcov(85));
    expect(updateCoverageBaseline(root)).toBe(8500);
    expect(baseline()).toBe(85);
    writeFileSync(join(root, 'coverage/lcov.info'), lcov(70));
    expect(updateCoverageBaseline(root)).toBeNull();
    expect(baseline()).toBe(85);
  });
});
