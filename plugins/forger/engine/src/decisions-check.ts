/**
 * The I/O half of `check decisions`: finds the branch's merge-base with the
 * base branch, reads the changed files and the manifests on both sides, and
 * hands them to the pure checker. A base branch that cannot be resolved is an
 * error, never an empty pass. The working tree counts, so the check is useful
 * before the commit as well as in CI.
 */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {loadConfig} from './config';
import {checkDecisions, diffDependencies, lineOf, manifestReaderFor, parseNameStatus, type ManifestChange} from './decisions';
import type {CommandRunner} from './git';
import type {Finding} from './waivers';

function mergeBase(run: CommandRunner, base: string): string {
  for (const ref of [base, `origin/${base}`]) {
    const sha = run(`git merge-base ${ref} HEAD`);
    if (sha !== '') return sha;
  }
  throw new Error(`Cannot find a merge-base with ${base}; fetch the base branch first`);
}

export function runDecisionsCheck(projectRoot: string, run: CommandRunner): Finding[] {
  const mb = mergeBase(run, loadConfig(projectRoot).base_branch);
  const changes = parseNameStatus(run(`git diff --name-status --no-renames ${mb}`));
  for (const path of run('git ls-files --others --exclude-standard').split('\n')) {
    if (path !== '' && !changes.some(c => c.path === path)) changes.push({path, status: 'added'});
  }
  const manifests: ManifestChange[] = [];
  for (const c of changes) {
    const read = manifestReaderFor(c.path);
    const disk = join(projectRoot, c.path);
    if (!read || c.status === 'deleted' || !existsSync(disk)) continue;
    const after = readFileSync(disk, 'utf-8');
    const before = c.status === 'added' ? '' : run(`git show ${mb}:${c.path}`);
    const diff = diffDependencies(before === '' ? null : before, after, read);
    manifests.push({path: c.path, diff, lines: Object.fromEntries(diff.added.map(n => [n, lineOf(after, n)]))});
  }
  return checkDecisions(changes, manifests);
}
