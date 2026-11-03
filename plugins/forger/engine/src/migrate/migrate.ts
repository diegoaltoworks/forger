/**
 * `migrate`: moves forger's files from the legacy layout (the harness folder) to
 * `.forger/`. The plan is a pure function over directory listings; the shell
 * moves with `git mv` where a path is tracked (so history follows) and a plain
 * rename elsewhere. A second run finds nothing to move, and a live engine
 * lock refuses it, because the engine reads and writes these files.
 */

import {existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync} from 'fs';
import {join} from 'path';

import {FORGER_DIR, LEGACY_DIR, OWNED, rewriteReferences, toLogical} from '../config';
import {RunnerLock} from '../loop';
import type {CommandRunner} from '../ports';
import {gitignoreLines, mergeGitignore} from '../packs';

export interface Move {
  name: string;
  tracked: boolean;
}

/** Pure: the forger-owned entries of the legacy folder that `.forger/` does not already hold. */
export function planMoves(legacy: string[], forger: string[], tracked: Set<string>): {moves: Move[]; skipped: string[]} {
  const held = new Set(forger);
  const owned = legacy.filter(n => OWNED.includes(n) || n.endsWith('.upstream')).sort();
  const skipped = owned.filter(n => held.has(n));
  const moves = owned.filter(n => !held.has(n)).map(name => ({name, tracked: tracked.has(name)}));
  return {moves, skipped};
}

/** Pure: the top-level names under the legacy folder from `git ls-files` output. */
export function trackedNames(lsFiles: string): Set<string> {
  const names = lsFiles
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith(`${LEGACY_DIR}/`))
    .map(l => l.slice(LEGACY_DIR.length + 1).split('/')[0]);
  return new Set(names);
}

export interface MigrateResult {
  status: 'migrated' | 'nothing';
  moved: string[];
  /** Names left in the legacy folder because `.forger/` already holds them. */
  skipped: string[];
  gitignoreAdded: string[];
}

export class MigrateRefused extends Error {}

function listing(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir) : [];
}

/** The text of a moved config file with its references to legacy-folder files pointing at the new folder. */
function rewriteFile(path: string): void {
  const before = readFileSync(path, 'utf-8');
  const after = rewriteReferences(before);
  if (after !== before) writeFileSync(path, after);
}

export function runMigrate(projectRoot: string, run: CommandRunner, lockFile: string = `${LEGACY_DIR}/runner.lock`): MigrateResult {
  const legacyDir = join(projectRoot, LEGACY_DIR);
  const forgerDir = join(projectRoot, FORGER_DIR);
  const tracked = trackedNames(run(`git ls-files -- ${LEGACY_DIR}`));
  const {moves, skipped} = planMoves(listing(legacyDir), listing(forgerDir), tracked);
  if (moves.length === 0) return {status: 'nothing', moved: [], skipped, gitignoreAdded: []};

  const holder = new RunnerLock(join(projectRoot, lockFile)).liveHolder();
  if (holder !== null) throw new MigrateRefused(`An engine (pid ${holder}) holds the lock; stop it before migrating`);

  mkdirSync(forgerDir, {recursive: true});
  for (const {name, tracked: isTracked} of moves) {
    const from = join(legacyDir, name);
    const to = join(forgerDir, name);
    if (isTracked) run(`git mv -- ${LEGACY_DIR}/${name} ${FORGER_DIR}/${name}`);
    if (!existsSync(to)) renameSync(from, to);
  }

  for (const file of ['workloop.config.json', 'testing.json']) {
    const path = join(forgerDir, file);
    if (existsSync(path)) rewriteFile(path);
  }
  const lock = join(forgerDir, 'forger.lock.json');
  if (existsSync(lock)) {
    const text = readFileSync(lock, 'utf-8');
    const next = text.replace(/("path"\s*:\s*")([^"]+)"/g, (_, key: string, p: string) => `${key}${toLogical(p)}"`);
    if (next !== text) writeFileSync(lock, next);
  }

  const ignorePath = join(projectRoot, '.gitignore');
  const merged = mergeGitignore(existsSync(ignorePath) ? readFileSync(ignorePath, 'utf-8') : '', gitignoreLines(FORGER_DIR));
  if (merged.added.length > 0) writeFileSync(ignorePath, merged.text);

  return {status: 'migrated', moved: moves.map(m => m.name), skipped, gitignoreAdded: merged.added};
}

export function formatMigrate(r: MigrateResult): string {
  if (r.status === 'nothing') return 'nothing to migrate';
  const lines = r.moved.map(n => `moved   ${LEGACY_DIR}/${n} -> ${FORGER_DIR}/${n}`);
  lines.push(...r.skipped.map(n => `kept    ${LEGACY_DIR}/${n} (${FORGER_DIR}/${n} already exists)`));
  lines.push(...r.gitignoreAdded.map(l => `ignored ${l}`));
  return lines.join('\n');
}
