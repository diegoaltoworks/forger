/**
 * The disposable checkouts `verify` and `critique` make, under the state
 * directory and not the system temp folder: on a machine whose temp folder is a
 * small quota-bound tmpfs, an install in the checkout fills it for everything
 * else the user runs.
 */

import {mkdirSync, mkdtempSync, rmSync, statfsSync} from 'fs';
import {join} from 'path';

const SPACE_CODES = new Set(['ENOSPC', 'EDQUOT']);
const SPACE_TEXT = /\b(ENOSPC|EDQUOT)\b|no space left on device|disk quota exceeded/i;

/** Whether an error says the disk or the quota is full, by its code or its text. Pure. */
export function isOutOfSpace(e: unknown): boolean {
  const code = (e as {code?: unknown} | null)?.code;
  if (typeof code === 'string' && SPACE_CODES.has(code)) return true;
  const message = e instanceof Error ? e.message : String(e);
  return SPACE_TEXT.test(message);
}

/** A byte count a person reads. Pure. */
export function formatBytes(n: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

/** What an out-of-space failure says: the folder, the space left there, and the cause. Pure. */
export function outOfSpaceMessage(dir: string, free: number | null, cause: string): string {
  const left = free === null ? 'free space unknown' : `${formatBytes(free)} free`;
  return `out of space in ${dir} (${left}): ${cause}`;
}

/** The bytes an unprivileged user may still write where `dir` lives; null when it cannot be read. */
export function freeBytes(dir: string): number | null {
  try {
    const s = statfsSync(dir);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

/** A fresh folder under `root`, which is created when missing. */
export function makeScratch(root: string, prefix: string): string {
  mkdirSync(root, {recursive: true});
  return mkdtempSync(join(root, prefix));
}

/** Removes a scratch folder and whatever an aborted run left in it. */
export function removeScratch(dir: string): void {
  rmSync(dir, {recursive: true, force: true});
}
