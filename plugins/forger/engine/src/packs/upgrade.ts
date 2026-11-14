/**
 * `setup --upgrade`: brings installed packs up to the plugin's current version
 * without losing the project's refinements. The decision is a pure function over
 * three hashes (the lock's, the disk's, the pack's); the shell only reads and
 * writes. A file whose hash differs from the lock is never overwritten.
 */

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';

import {DEFAULT_PACKS, LOCK_PATH, loadPacks, parseLock, renderLock, sha256, type Lock, type LockedFile, type LockedPack} from './packs';
import {forgerPath, loadConfig} from '../config';
import {relocatableGates} from './setup';
import {finishStructure, formatStructureSetup, type StructureSetup} from './structure-defaults';
import type {CommandRunner} from '../ports';
import {newerFlavour, parseFlavourRef, shippedFlavour} from '../pipeline';

export type UpgradeAction =
  | 'unchanged' // nothing differs
  | 'take-upstream' // the project never touched it and the pack moved: write it, update the lock
  | 'keep' // the project refined it and the pack did not move
  | 'converged' // the project's file already equals the pack's: update the lock only
  | 'conflict' // both moved apart: keep the project file, write the pack's beside it
  | 'install' // new in the pack
  | 'project-owned' // new in the pack, but the project already has a file there
  | 'deleted' // the project removed a file forger installed: not recreated
  | 'removed'; // gone from the pack: reported, never deleted

/** A hash, or null when the file does not exist there. */
export interface Hashes {
  lock: string | null;
  disk: string | null;
  upstream: string | null;
}

export function classify({lock, disk, upstream}: Hashes): UpgradeAction {
  if (upstream === null) return 'removed';
  if (lock === null) return disk === null ? 'install' : 'project-owned';
  if (disk === null) return 'deleted';
  if (disk === lock) return upstream === lock ? 'unchanged' : 'take-upstream';
  if (upstream === lock) return 'keep';
  return disk === upstream ? 'converged' : 'conflict';
}

export interface UpgradeEntry {
  pack: string;
  path: string;
  action: UpgradeAction;
  /** Set for a conflict: where the pack's version was written. */
  upstreamFile?: string;
}

/** A pinned flavour the plugin ships a newer version of; the owner takes it by changing the pin. */
export interface FlavourUpgrade {
  name: string;
  pinned: number;
  available: number;
}

export interface UpgradeResult {
  files: UpgradeEntry[];
  /** Set when the config's flavour is pinned to a version older than the plugin's. */
  flavour?: FlavourUpgrade;
  /** Set when the config's gates named the plugin by absolute path and now name it by variable. */
  gates?: 'rewritten';
  /** Default packs the lock did not hold and this run installed. */
  added: string[];
  structure?: StructureSetup;
  /** Files the owner has to decide about. */
  review: string[];
}

export const UPSTREAM_SUFFIX = '.upstream';

function hashOf(path: string): string | null {
  return existsSync(path) ? sha256(readFileSync(path)) : null;
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, content);
}

function newerFlavourPin(projectRoot: string, pluginRoot: string): FlavourUpgrade | undefined {
  const ref = parseFlavourRef(loadConfig(projectRoot).flavour);
  const available = newerFlavour(ref, shippedFlavour(pluginRoot, ref.name));
  return available === null || ref.version === null ? undefined : {name: ref.name, pinned: ref.version, available};
}

/** Rewrites an absolute check command in the config's gates, leaving the rest of the file as it is. */
function relocateGates(projectRoot: string): boolean {
  const path = forgerPath(projectRoot, '.forger/workloop.config.json');
  if (!existsSync(path)) return false;
  const text = readFileSync(path, 'utf-8');
  let gates: unknown;
  try {
    gates = (JSON.parse(text) as {gates?: unknown}).gates;
  } catch {
    return false;
  }
  if (typeof gates !== 'string') return false;
  const next = relocatableGates(gates);
  if (next === gates) return false;
  const literal = JSON.stringify(gates);
  write(path, text.includes(literal) ? text.replace(literal, () => JSON.stringify(next)) : JSON.stringify({...JSON.parse(text), gates: next}, null, 2) + '\n');
  return true;
}

export function runUpgrade(projectRoot: string, pluginRoot: string, run?: CommandRunner): UpgradeResult {
  const lockPath = forgerPath(projectRoot, LOCK_PATH);
  if (!existsSync(lockPath)) throw new Error(`${LOCK_PATH} not found: run setup before upgrading`);
  const lock = parseLock(readFileSync(lockPath, 'utf-8'));
  const available = loadPacks(pluginRoot);

  const missing = DEFAULT_PACKS.filter(id => !lock.packs.some(p => p.id === id) && available.some(p => p.manifest.id === id));
  const files: UpgradeEntry[] = [];
  const packs: LockedPack[] = [...lock.packs, ...missing.map((id): LockedPack => ({id, version: '', files: []}))].map(locked => {
    const pack = available.find(p => p.manifest.id === locked.id);
    if (!pack) throw new Error(`Pack ${locked.id} is in ${LOCK_PATH} but not in this plugin`);
    const next: LockedFile[] = [];
    const lockedByPath = new Map(locked.files.map(f => [f.path, f.sha256]));

    for (const f of pack.manifest.files) {
      const upstream = readFileSync(join(pack.dir, f.source), 'utf-8');
      const target = forgerPath(projectRoot, f.target);
      const lockHash = lockedByPath.get(f.target) ?? null;
      const disk = hashOf(target);
      const action = classify({lock: lockHash, disk, upstream: sha256(upstream)});
      const entry: UpgradeEntry = {pack: locked.id, path: f.target, action};

      if (action === 'take-upstream' || action === 'install') {
        write(target, upstream);
        next.push({path: f.target, sha256: sha256(upstream)});
      } else if (action === 'converged') {
        next.push({path: f.target, sha256: sha256(upstream)});
      } else if (action === 'conflict') {
        entry.upstreamFile = f.target + UPSTREAM_SUFFIX;
        write(forgerPath(projectRoot, entry.upstreamFile), upstream);
        next.push({path: f.target, sha256: lockHash as string});
      } else if (lockHash !== null) {
        next.push({path: f.target, sha256: lockHash});
      }
      files.push(entry);
    }

    const current = new Set(pack.manifest.files.map(f => f.target));
    for (const f of locked.files) {
      if (current.has(f.path)) continue;
      files.push({pack: locked.id, path: f.path, action: 'removed'});
      next.push(f);
    }
    next.sort((a, b) => a.path.localeCompare(b.path));
    return {id: locked.id, version: pack.manifest.version, files: next};
  });

  const nextLock: Lock = {packs};
  const text = renderLock(nextLock);
  if (readFileSync(lockPath, 'utf-8') !== text) write(lockPath, text);

  const flavour = newerFlavourPin(projectRoot, pluginRoot);
  const relocated = relocateGates(projectRoot);

  const structure = missing.includes('structure')
    ? finishStructure(projectRoot, files.some(f => f.path === '.forger/structure.json' && f.action === 'install'), run)
    : undefined;

  const review = files.filter(f => f.action === 'conflict' || f.action === 'removed' || f.action === 'deleted').map(f => f.path);
  return {files, review, added: missing, ...(structure ? {structure} : {}), ...(flavour ? {flavour} : {}), ...(relocated ? {gates: 'rewritten' as const} : {})};
}

export function formatUpgrade(result: UpgradeResult): string {
  const lines = result.files.filter(f => f.action !== 'unchanged').map(f => `${f.action.padEnd(14)} ${f.path}${f.upstreamFile ? ` (pack version in ${f.upstreamFile})` : ''}`);
  lines.unshift(...result.added.map(id => `added          pack ${id}`));
  if (result.structure) lines.push(...formatStructureSetup(result.structure));
  if (result.gates) lines.push('rewritten      gates in the config now name the plugin by variable');
  if (result.flavour) lines.push(`flavour        ${result.flavour.name}@${result.flavour.available} is available (config pins @${result.flavour.pinned}); change "flavour" in the config to take it`);
  return lines.length === 0 ? 'already up to date' : lines.join('\n');
}

/** The checks after an upgrade: which failed, or why none could run. */
export type UpgradeChecks = {failing: FailingCheck[]} | {error: string};

export interface FailingCheck {
  check: string;
  findings: number;
}

const WRITING_ACTIONS: UpgradeAction[] = ['install', 'take-upstream', 'conflict'];

/** An upgrade that wrote no file and added no pack cannot have changed what a check sees. */
export function upgradeChangedFiles(result: UpgradeResult): boolean {
  return result.added.length > 0 || result.files.some(f => WRITING_ACTIONS.includes(f.action));
}

/** Only a failed check counts; a waived or unmeasured one is not a new failure. */
export function failingChecksOf(report: {results: {check: string; status: string; violations: unknown[]}[]}): FailingCheck[] {
  return report.results.filter(r => r.status === 'failed').map(r => ({check: r.check, findings: r.violations.length}));
}

export function formatUpgradeChecks(checks: UpgradeChecks): string[] {
  if ('error' in checks) return [`checks         could not run: ${checks.error}`];
  if (checks.failing.length === 0) return ['checks         pass after the upgrade'];
  return checks.failing.map(f => `failing        check ${f.check}: ${f.findings} finding(s); run check for the detail`);
}
