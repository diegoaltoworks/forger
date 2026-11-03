/**
 * The I/O half of `check tests` and `check coverage`: reads the branch's
 * commits and diff against the merge-base, the repository's test files and the
 * coverage report, and hands them to the pure rules. A missing config, an
 * unresolvable base or a missing report is an error, never a pass.
 */

import {existsSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';

import {loadConfig} from '../../config';
import {parseNameStatus} from '../decisions';
import type {CommandRunner} from '../../ports';
import {
  TESTING_PATH,
  basisPoints,
  checkCoverage,
  checkFixHasTest,
  checkNoNetwork,
  nextBaseline,
  parseBaseline,
  parseLcov,
  parseTestingConfig,
  renderBaseline,
  type Baseline,
  type TestingConfig,
} from './testing';
import {globToRegExp, type Finding} from '../waivers';

function readConfig(projectRoot: string): TestingConfig {
  const path = join(projectRoot, TESTING_PATH);
  if (!existsSync(path)) throw new Error(`${TESTING_PATH} not found; the testing pack's config is required`);
  return parseTestingConfig(readFileSync(path, 'utf-8'));
}

function mergeBase(run: CommandRunner, base: string): string {
  for (const ref of [base, `origin/${base}`]) {
    const sha = run(`git merge-base ${ref} HEAD`);
    if (sha !== '') return sha;
  }
  throw new Error(`Cannot find a merge-base with ${base}; fetch the base branch first`);
}

export function runTestsCheck(projectRoot: string, run: CommandRunner): Finding[] {
  const config = readConfig(projectRoot);
  const mb = mergeBase(run, loadConfig(projectRoot).base_branch);
  const subjects = run(`git log --format=%s ${mb}..HEAD`).split('\n').filter(s => s !== '');
  const changes = parseNameStatus(run(`git diff --name-status --no-renames ${mb}`)).filter(c => c.status !== 'deleted');
  const untracked = run('git ls-files --others --exclude-standard').split('\n').filter(p => p !== '');
  const changed = [...new Set([...changes.map(c => c.path), ...untracked])].filter(p => existsSync(join(projectRoot, p)));

  const tracked = run('git ls-files').split('\n').filter(p => p !== '');
  const testGlobs = config.test_paths.map(globToRegExp);
  const files = [...new Set([...tracked, ...untracked])]
    .filter(p => testGlobs.some(re => re.test(p)))
    .filter(p => existsSync(join(projectRoot, p)))
    .map(path => ({path, content: readFileSync(join(projectRoot, path), 'utf-8')}));
  return [...checkFixHasTest(subjects, changed, config), ...checkNoNetwork(files, config)];
}

function readBaseline(projectRoot: string, config: TestingConfig): Baseline | null {
  const path = join(projectRoot, config.coverage_baseline);
  return existsSync(path) ? parseBaseline(readFileSync(path, 'utf-8'), config.coverage_baseline) : null;
}

function currentCoverage(projectRoot: string, config: TestingConfig): number {
  const path = join(projectRoot, config.coverage_report);
  if (!existsSync(path)) throw new Error(`Coverage report ${config.coverage_report} not found; run the tests with lcov coverage first`);
  return basisPoints(parseLcov(readFileSync(path, 'utf-8')));
}

export function runCoverageCheck(projectRoot: string, _run: CommandRunner): Finding[] {
  const config = readConfig(projectRoot);
  return checkCoverage(currentCoverage(projectRoot, config), readBaseline(projectRoot, config), config.coverage_baseline);
}

/** Raises the baseline to the current coverage; returns the new value in basis points, or null when nothing changed. */
export function updateCoverageBaseline(projectRoot: string): number | null {
  const config = readConfig(projectRoot);
  const next = nextBaseline(currentCoverage(projectRoot, config), readBaseline(projectRoot, config));
  if (next !== null) writeFileSync(join(projectRoot, config.coverage_baseline), renderBaseline(next));
  return next;
}
