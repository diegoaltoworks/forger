/**
 * The I/O half of `check decisions`: finds the branch's merge-base with the
 * base branch, reads the changed files and the manifests on both sides, and
 * hands them to the pure checker. A base branch that cannot be resolved is an
 * error, never an empty pass. The working tree counts, so the check is useful
 * before the commit as well as in CI.
 */

import {existsSync, readdirSync, readFileSync} from 'fs';
import {join} from 'path';

import {FORGER_DIR, LEGACY_DIR, loadConfig, toLogical} from '../../config';
import {ARCH_PATH} from '../arch';
import {ADR_DIR, checkDecisionNumbers, checkDecisions, diffAgainstMoved, diffDependencies, layerMapChanged, lineOf, manifestReaderFor, parseNameStatus, type FileChange, type ManifestChange} from './decisions';
import type {CommandRunner} from '../../ports';
import type {Finding} from '../waivers';

export function mergeBase(run: CommandRunner, base: string): string {
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
  const deletedTexts = (name: string) =>
    changes.filter(c => c.status === 'deleted' && c.path.split('/').pop() === name).map(c => run(`git show ${mb}:${c.path}`)).filter(t => t !== '');
  for (const c of changes) {
    const read = manifestReaderFor(c.path);
    const disk = join(projectRoot, c.path);
    if (!read || c.status === 'deleted' || !existsSync(disk)) continue;
    const after = readFileSync(disk, 'utf-8');
    const before = c.status === 'added' ? '' : run(`git show ${mb}:${c.path}`);
    const diff =
      c.status === 'added' ? diffAgainstMoved(after, deletedTexts(c.path.split('/').pop() ?? ''), read) : diffDependencies(before === '' ? null : before, after, read);
    manifests.push({path: c.path, diff, lines: Object.fromEntries(diff.added.map(n => [n, lineOf(after, n)]))});
  }
  const adrDir = join(projectRoot, ADR_DIR);
  const numbers = checkDecisionNumbers(existsSync(adrDir) ? readdirSync(adrDir).filter(n => n.endsWith('.md')) : []);
  return [...checkDecisions(settleLayerMap(projectRoot, run, mb, changes), manifests), ...numbers];
}

/** The layer map is judged by content across both homes: a move with the same content is no change. */
function settleLayerMap(projectRoot: string, run: CommandRunner, mb: string, changes: FileChange[]): FileChange[] {
  const touched = changes.filter(c => toLogical(c.path) === ARCH_PATH);
  if (touched.length === 0) return changes;
  const homes = [`${FORGER_DIR}/architecture.json`, `${LEGACY_DIR}/architecture.json`];
  const before = homes.map(h => run(`git show ${mb}:${h}`)).find(t => t !== '') ?? null;
  const onDisk = homes.map(h => join(projectRoot, h)).find(p => existsSync(p));
  const after = onDisk ? readFileSync(onDisk, 'utf-8') : null;
  const rest = changes.filter(c => !touched.includes(c));
  return layerMapChanged(before, after) ? [...rest, {path: ARCH_PATH, status: 'modified'}] : rest;
}
