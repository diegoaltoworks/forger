/**
 * The I/O half of `check safety`: finds the branch's merge-base with the base
 * branch, reads the diff and the untracked files, and hands them to the pure
 * checks. A missing config or an unresolvable base is an error, never a pass.
 * The working tree counts, so the check is useful before the commit as well as
 * in CI.
 */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {loadConfig} from '../../config';
import {parseNameStatus} from '../decisions';
import type {CommandRunner} from '../../ports';
import {SAFETY_PATH, checkDataForward, checkSecrets, isEnvFile, parseAddedLines, parseSafetyConfig, type AddedLine} from './safety';
import type {Finding} from '../waivers';

function mergeBase(run: CommandRunner, base: string): string {
  for (const ref of [base, `origin/${base}`]) {
    const sha = run(`git merge-base ${ref} HEAD`);
    if (sha !== '') return sha;
  }
  throw new Error(`Cannot find a merge-base with ${base}; fetch the base branch first`);
}

export function runSafetyCheck(projectRoot: string, run: CommandRunner): Finding[] {
  const configPath = join(projectRoot, SAFETY_PATH);
  if (!existsSync(configPath)) throw new Error(`${SAFETY_PATH} not found; the safety pack's config is required`);
  const config = parseSafetyConfig(readFileSync(configPath, 'utf-8'));
  const mb = mergeBase(run, loadConfig(projectRoot).base_branch);

  const changes = parseNameStatus(run(`git diff --name-status --no-renames ${mb}`)).filter(c => c.status !== 'deleted');
  const untracked = run('git ls-files --others --exclude-standard').split('\n').filter(p => p !== '' && existsSync(join(projectRoot, p)));
  const paths = [...new Set([...changes.map(c => c.path), ...untracked])];

  const added: AddedLine[] = parseAddedLines(run(`git diff -U0 --no-color --no-renames ${mb}`));
  for (const path of untracked) {
    const text = readFileSync(join(projectRoot, path), 'utf-8');
    text.split('\n').forEach((line, i) => added.push({file: path, line: i + 1, text: line}));
  }
  return [...checkSecrets(added, paths.filter(isEnvFile)), ...checkDataForward(paths, config)];
}
