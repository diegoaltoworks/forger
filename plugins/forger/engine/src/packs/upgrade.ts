/**
 * `setup --upgrade`: brings installed packs up to the plugin's current version
 * without losing the project's refinements. The decision is a pure function over
 * three hashes (the lock's, the disk's, the pack's); the shell only reads and
 * writes. A file whose hash differs from the lock is never overwritten.
 */

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';

import {LOCK_PATH, loadPacks, parseLock, renderLock, sha256, type Lock, type LockedFile, type LockedPack} from './packs';

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

export interface UpgradeResult {
  files: UpgradeEntry[];
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

export function runUpgrade(projectRoot: string, pluginRoot: string): UpgradeResult {
  const lockPath = join(projectRoot, LOCK_PATH);
  if (!existsSync(lockPath)) throw new Error(`${LOCK_PATH} not found: run setup before upgrading`);
  const lock = parseLock(readFileSync(lockPath, 'utf-8'));
  const available = loadPacks(pluginRoot);

  const files: UpgradeEntry[] = [];
  const packs: LockedPack[] = lock.packs.map(locked => {
    const pack = available.find(p => p.manifest.id === locked.id);
    if (!pack) throw new Error(`Pack ${locked.id} is in ${LOCK_PATH} but not in this plugin`);
    const next: LockedFile[] = [];
    const lockedByPath = new Map(locked.files.map(f => [f.path, f.sha256]));

    for (const f of pack.manifest.files) {
      const upstream = readFileSync(join(pack.dir, f.source), 'utf-8');
      const target = join(projectRoot, f.target);
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
        write(join(projectRoot, entry.upstreamFile), upstream);
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

  const review = files.filter(f => f.action === 'conflict' || f.action === 'removed' || f.action === 'deleted').map(f => f.path);
  return {files, review};
}

export function formatUpgrade(result: UpgradeResult): string {
  const lines = result.files.filter(f => f.action !== 'unchanged').map(f => `${f.action.padEnd(14)} ${f.path}${f.upstreamFile ? ` (pack version in ${f.upstreamFile})` : ''}`);
  return lines.length === 0 ? 'already up to date' : lines.join('\n');
}
