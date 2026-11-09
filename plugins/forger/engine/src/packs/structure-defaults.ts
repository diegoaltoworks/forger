/**
 * Fills the structure pack's config from what the repository shows: a `next`
 * dependency adds the server-only guard, workspaces add one boundary group per
 * package that allows no cross-imports. The decisions are pure; the reader and
 * writer are the thin shell. Nothing is frozen by default.
 */

import {existsSync, readdirSync, readFileSync, statSync, writeFileSync} from 'fs';
import {join} from 'path';

import {STRUCTURE_BASELINE_PATH, STRUCTURE_PATH, writeStructureBaseline, type Boundary, type ServerGuard} from '../checks';
import {forgerPath} from '../config';
import type {CommandRunner} from '../ports';

export interface StructureFacts {
  deps: string[];
  /** Workspace package directories, relative to the root, `/`-separated. */
  workspaces: string[];
}

export interface StructureDefaults {
  server_guards: ServerGuard[];
  boundaries: Boundary[];
}

export const SERVER_GUARD: ServerGuard = {files: '**/*.server.*', must_import: 'server-only'};

/** The settings the facts imply; pure. */
export function structureDefaults(facts: StructureFacts): StructureDefaults {
  return {
    server_guards: facts.deps.includes('next') ? [SERVER_GUARD] : [],
    boundaries: facts.workspaces.map(dir => ({name: dir, paths: [`${dir}/**`], may_import: []})),
  };
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** A workspace pattern is a directory or `<dir>/*`; other globs are not expanded. */
function expand(root: string, pattern: string): string[] {
  const clean = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
  if (clean === '' || clean.startsWith('!') || clean.startsWith('/') || clean.split('/').includes('..')) return [];
  if (!clean.includes('*')) return isDir(join(root, clean)) ? [clean] : [];
  if (!/^[^*]+\/\*$/.test(clean)) return [];
  const parent = clean.slice(0, -2);
  if (!isDir(join(root, parent))) return [];
  return readdirSync(join(root, parent))
    .filter(n => !n.startsWith('.') && n !== 'node_modules' && isDir(join(root, parent, n)))
    .map(n => `${parent}/${n}`);
}

function pnpmPatterns(text: string): string[] {
  const out: string[] = [];
  let inPackages = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^packages\s*:/.test(line)) inPackages = true;
    else if (/^\S/.test(line)) inPackages = false;
    else if (inPackages) {
      const m = /^\s*-\s*['"]?([^'"#\s]+)['"]?/.exec(line);
      if (m) out.push(m[1]);
    }
  }
  return out;
}

/** The deps and workspace packages of the root; an unreadable package.json is skipped, since setup must not fail on it. */
export function readStructureFacts(root: string): StructureFacts {
  let deps: string[] = [];
  const patterns: string[] = [];
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
      const names = (k: string): string[] => (typeof pkg[k] === 'object' && pkg[k] !== null && !Array.isArray(pkg[k]) ? Object.keys(pkg[k] as object) : []);
      deps = [...names('dependencies'), ...names('devDependencies')];
      const ws = pkg.workspaces;
      const list = Array.isArray(ws) ? ws : ws && typeof ws === 'object' ? (ws as {packages?: unknown}).packages : undefined;
      if (Array.isArray(list)) patterns.push(...list.filter((p): p is string => typeof p === 'string'));
    } catch {
      // an invalid package.json yields no facts
    }
  }
  const pnpm = join(root, 'pnpm-workspace.yaml');
  if (existsSync(pnpm)) patterns.push(...pnpmPatterns(readFileSync(pnpm, 'utf-8')));
  return {deps, workspaces: [...new Set(patterns.flatMap(p => expand(root, p)))].sort()};
}

/**
 * Writes the defaults into `.forger/structure.json` for the lists still empty and
 * returns the boundary groups it added, so setup can print them for the owner.
 */
export function applyStructureDefaults(root: string): {server_guards: number; boundaries: Boundary[]} {
  const path = forgerPath(root, STRUCTURE_PATH);
  const none = {server_guards: 0, boundaries: [] as Boundary[]};
  if (!existsSync(path)) return none;
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch {
    return none;
  }
  const defaults = structureDefaults(readStructureFacts(root));
  const empty = (k: string): boolean => !Array.isArray(config[k]) || (config[k] as unknown[]).length === 0;
  const added = {
    server_guards: empty('server_guards') ? defaults.server_guards : [],
    boundaries: empty('boundaries') ? defaults.boundaries : [],
  };
  if (added.server_guards.length === 0 && added.boundaries.length === 0) return none;
  if (added.server_guards.length > 0) config.server_guards = added.server_guards;
  if (added.boundaries.length > 0) config.boundaries = added.boundaries;
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
  return {server_guards: added.server_guards.length, boundaries: added.boundaries};
}

export interface StructureSetup {
  server_guards: number;
  /** The boundary groups added, for the owner to widen. */
  boundaries: Boundary[];
  /** Entries recorded in the new baseline; null when none was written. */
  baseline: number | null;
  /** Why no baseline was written, when the listing of files failed (not a git repository). */
  baselineError?: string;
}

/**
 * What an install of the structure pack finishes: defaults from the repo's facts
 * when its config was just written, and the baseline when none exists, so the
 * repository starts green. Without a runner (no git listing) no baseline is written.
 */
export function finishStructure(root: string, configWritten: boolean, run?: CommandRunner): StructureSetup {
  const added = configWritten ? applyStructureDefaults(root) : {server_guards: 0, boundaries: [] as Boundary[]};
  let baseline: number | null = null;
  let baselineError: string | undefined;
  if (run && !existsSync(forgerPath(root, STRUCTURE_BASELINE_PATH))) {
    try {
      baseline = writeStructureBaseline(root, run);
    } catch (e) {
      baselineError = (e as Error).message;
    }
  }
  return {...added, baseline, ...(baselineError ? {baselineError} : {})};
}

export function formatStructureSetup(s: StructureSetup): string[] {
  return [
    ...(s.server_guards > 0 ? ['structure  server-only guard added for **/*.server.* (next dependency)'] : []),
    ...(s.boundaries.length > 0
      ? ['structure  boundary groups, no cross-imports; widen may_import in .forger/structure.json:', ...s.boundaries.map(b => `             ${b.name} (${b.paths.join(', ')})`)]
      : []),
    ...(s.baselineError ? [`structure  no baseline written (${s.baselineError}); run "check structure --baseline" in the repository`] : []),
    ...(s.baseline !== null ? [`structure  baseline recorded: ${s.baseline} existing finding(s) in ${STRUCTURE_BASELINE_PATH}`] : []),
  ];
}
