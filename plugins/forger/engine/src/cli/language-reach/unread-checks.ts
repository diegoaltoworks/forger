/**
 * After an install, which of the installed checks will report a gap for this
 * repository because they cannot read the imports of some of its source
 * languages. Without it a repository in another language learns it at the
 * first `check`, or never reads the gap.
 */

import {existsSync, readFileSync} from 'fs';

import {archUnread, checksToRun, structureUnread} from '../../checks';
import {forgerPath} from '../../config';
import type {CommandRunner} from '../../ports';
import {LOCK_PATH, loadPacks, parseLock} from '../../packs';

export interface UnreadCheck {
  check: string;
  extensions: string[];
  files: number;
}

const READERS: Record<string, typeof archUnread> = {arch: archUnread, structure: structureUnread};

export function unreadChecks(projectRoot: string, pluginRoot: string, run: CommandRunner): UnreadCheck[] {
  const lockPath = forgerPath(projectRoot, LOCK_PATH);
  if (!existsSync(lockPath)) return [];
  const installed = checksToRun(loadPacks(pluginRoot), parseLock(readFileSync(lockPath, 'utf-8')));
  const out: UnreadCheck[] = [];
  for (const check of installed.filter(c => c in READERS)) {
    const unread = READERS[check](projectRoot, run);
    if (unread.length > 0) out.push({check, extensions: unread.map(u => u.extension), files: unread.reduce((n, u) => n + u.count, 0)});
  }
  return out;
}

export function formatUnread(unread: UnreadCheck[]): string[] {
  return unread.map(u => `unread   ${u.check} cannot read imports in ${u.extensions.join(', ')} files; it reports a gap, not a pass`);
}
