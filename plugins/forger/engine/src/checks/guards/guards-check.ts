/**
 * The I/O half of `check guards`: reads the branch's diff against its
 * merge-base, the guard files on both sides, and the ticket of the branch
 * (`feat/issue-<n>`) for the owner's decisions. A base branch that cannot be
 * resolved is an error, never a pass. The working tree counts, so the check
 * serves before the commit as well as in CI.
 */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {forgerPath, loadConfig} from '../../config';
import type {CommandRunner} from '../../ports';
import {BASELINE_MANIFEST} from '../../ui';
import {mergeBase, parseNameStatus} from '../decisions';
import type {Finding} from '../waivers';
import {BUDGETS_BASELINE_PATH, BUDGETS_PATH, directionsOf, parseBudgets} from '../budgets/budgets';
import {addedLines, decisionsText, deletedFile, loosened, loosenedBudgets, matches, skipsIn, withoutDecided} from './guards';

function jsonOf(projectRoot: string, rel: string): Record<string, unknown> | null {
  const file = forgerPath(projectRoot, rel);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The configured guard globs, else the installed packs' guard files. */
function guardGlobs(projectRoot: string): string[] {
  const configured = loadConfig(projectRoot).guards;
  if (configured) return configured;
  const baseline = jsonOf(projectRoot, '.forger/testing.json')?.coverage_baseline;
  const out: string[] = typeof baseline === 'string' ? [baseline] : [];
  if (existsSync(forgerPath(projectRoot, BUDGETS_PATH))) out.push(BUDGETS_BASELINE_PATH);
  if (jsonOf(projectRoot, '.forger/ui.json') !== null) out.push(BASELINE_MANIFEST);
  return out;
}

function testGlobs(projectRoot: string): string[] {
  const paths = jsonOf(projectRoot, '.forger/testing.json')?.test_paths;
  return Array.isArray(paths) && paths.every(p => typeof p === 'string') ? (paths as string[]) : ['**/*.test.*', '**/*.spec.*'];
}

export function decisionsOfBranch(run: CommandRunner): string {
  const issue = /^feat\/issue-(\d+)/.exec(run('git rev-parse --abbrev-ref HEAD').trim())?.[1];
  if (!issue) return '';
  try {
    return decisionsText(run(`gh issue view ${issue} --json body --jq .body`));
  } catch {
    return '';
  }
}

/** The direction of each budget as the base branch had it, else as the tree has it: a diff cannot flip a direction to excuse a number. */
function budgetDirections(projectRoot: string, run: CommandRunner, mb: string) {
  const read = (text: () => string) => {
    try {
      return directionsOf(parseBudgets(text()));
    } catch {
      return {};
    }
  };
  const file = forgerPath(projectRoot, BUDGETS_PATH);
  const onDisk = existsSync(file) ? read(() => readFileSync(file, 'utf-8')) : {};
  return {...onDisk, ...read(() => run(`git show ${mb}:${BUDGETS_PATH}`))};
}

export function runGuardsCheck(projectRoot: string, run: CommandRunner): Finding[] {
  const mb = mergeBase(run, loadConfig(projectRoot).base_branch);
  const changes = parseNameStatus(run(`git diff --name-status --no-renames ${mb}`));
  const untracked = run('git ls-files --others --exclude-standard').split('\n').filter(p => p !== '');
  for (const path of untracked) if (!changes.some(c => c.path === path)) changes.push({path, status: 'added'});

  const guards = guardGlobs(projectRoot);
  const tests = testGlobs(projectRoot);
  const added = new Set(changes.filter(c => c.status === 'added').map(c => c.path.split('/').pop()));
  const findings: Finding[] = [];
  for (const c of changes) {
    const disk = join(projectRoot, c.path);
    const isGuard = matches([c.path], guards).length > 0;
    const isTest = matches([c.path], tests).length > 0;
    if (c.status === 'deleted') {
      if (isGuard) findings.push(deletedFile(c.path, 'guard'));
      else if (isTest && !added.has(c.path.split('/').pop())) findings.push(deletedFile(c.path, 'test'));
      continue;
    }
    if (!existsSync(disk)) continue;
    if (isGuard && c.status === 'modified') {
      const [before, after] = [run(`git show ${mb}:${c.path}`), readFileSync(disk, 'utf-8')];
      findings.push(...(c.path === BUDGETS_BASELINE_PATH ? loosenedBudgets(c.path, before, after, budgetDirections(projectRoot, run, mb)) : loosened(c.path, before, after)));
    }
    if (isTest) {
      const lines =
        c.status === 'added'
          ? readFileSync(disk, 'utf-8').split('\n').map((text, i) => ({line: i + 1, text}))
          : addedLines(run(`git diff -U0 ${mb} -- ${c.path}`));
      findings.push(...skipsIn(c.path, lines));
    }
  }
  return findings.length === 0 ? [] : withoutDecided(findings, decisionsOfBranch(run));
}
