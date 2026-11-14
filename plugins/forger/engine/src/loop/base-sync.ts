/**
 * The engine runs its own code from the loop's checkout, so a base branch that
 * sits behind its remote means every restart runs old code. These are the pure
 * decisions over the git facts a caller gathered.
 */

import type {CommandRunner} from '../ports';

export interface BaseSync {
  /** Commits `origin/<base>` has that the local base branch lacks; null when it could not be told. */
  behind: number | null;
  /** The working tree has no uncommitted changes besides the engine's own runtime files. */
  clean: boolean;
  /** The checkout is on the base branch. */
  onBase: boolean;
  /** The uncommitted paths besides the engine's own runtime files. */
  changed: string[];
}

/** Whether `path` is one of the runtime files; a pattern ending in a slash names a folder. */
export function isRuntimeFile(path: string, runtimeFiles: string[]): boolean {
  return runtimeFiles.some(f => (f.endsWith('/') ? path.startsWith(f) : path === f));
}

/** True when every change `git status --porcelain` lists is a runtime file. */
export function onlyRuntimeChanges(porcelain: string, runtimeFiles: string[]): boolean {
  return nonRuntimeChanges(porcelain, runtimeFiles).length === 0;
}

/** The changed paths `git status --porcelain` lists that are not runtime files. */
export function nonRuntimeChanges(porcelain: string, runtimeFiles: string[]): string[] {
  return porcelain
    .split('\n')
    .filter(l => l.trim() !== '')
    .map(l => l.slice(3).replace(/^"|"$/g, ''))
    .filter(path => !isRuntimeFile(path, runtimeFiles));
}

export type BaseSyncPlan = 'none' | 'fast-forward';

/** `run` closes the gap itself only on the base branch, with nothing of the owner's uncommitted, and while no engine holds the lock. */
export function planBaseSync(sync: BaseSync, engineAlive: boolean): BaseSyncPlan {
  if (sync.behind === null || sync.behind <= 0 || !sync.onBase || !sync.clean || engineAlive) return 'none';
  return 'fast-forward';
}

/** The refusal `run` gives when the fast-forward failed, carrying git's own reason. */
export function fastForwardRefusal(base: string, reason: string): string {
  return `the fast-forward of ${base} to origin/${base} failed, and nothing was stashed, reset or discarded: ${reason.trim() || 'git gave no reason'}`;
}

/** True when a changed path (relative to the repository root) lies under the plugin the engine runs from. */
export function touchesPlugin(changed: string, pluginDir: string): boolean {
  if (pluginDir === '' || pluginDir.startsWith('..')) return false;
  const prefix = pluginDir.endsWith('/') ? pluginDir : `${pluginDir}/`;
  return changed.split('\n').some(f => f.startsWith(prefix));
}

/** One line naming the gap and the command that closes it. */
export function behindBaseMessage(base: string, behind: number, dirty = false): string {
  const gap = `the checkout's ${base} is ${behind} commit(s) behind origin/${base}, so the engine runs old code`;
  return dirty ? `${gap}; \`run\` does not bring it up to date while the checkout has uncommitted changes` : `${gap}; \`run\` fast-forwards it before its first pick`;
}

/** The anomaly `orient` reports for a checkout with uncommitted changes while no engine is alive. */
export function dirtyCheckoutAnomaly(sync: BaseSync | undefined, engineAlive: boolean): string | null {
  if (engineAlive || !sync || sync.changed.length === 0) return null;
  return `the loop's checkout has uncommitted changes (${sync.changed.join(', ')}); \`run\` leaves such a checkout as it is, so the engine runs from it as it stands`;
}

/** The anomaly `orient` reports: only while no engine is alive, since a live one cannot be updated under itself. */
export function behindBaseAnomaly(sync: BaseSync | undefined, base: string, engineAlive: boolean): string | null {
  if (engineAlive || !sync || sync.behind === null || sync.behind <= 0) return null;
  return behindBaseMessage(base, sync.behind, sync.changed.length > 0);
}

/** Reads the facts; a fetch or compare that fails leaves `behind` unknown. */
export function readBaseSync(run: CommandRunner, base: string, runtimeFiles: string[] = []): BaseSync {
  let behind: number | null = null;
  try {
    run(`git fetch --quiet origin ${base}`);
    const n = Number(run(`git rev-list --count ${base}..origin/${base}`).trim());
    behind = Number.isInteger(n) ? n : null;
  } catch {
    behind = null;
  }
  let changed: string[] = [];
  let clean = false;
  try {
    changed = nonRuntimeChanges(run('git status --porcelain'), runtimeFiles);
    clean = changed.length === 0;
  } catch {
    clean = false;
  }
  let onBase = false;
  try {
    onBase = run('git branch --show-current').trim() === base;
  } catch {
    onBase = false;
  }
  return {behind, clean, onBase, changed};
}

/** The message for a state-branch write that was refused, naming who pushed. */
export function stateWriteFailure(identity: string | null): string {
  const who = identity ? `the GitHub identity in use is "${identity}"` : 'the GitHub identity in use could not be read';
  return `forger: could not write the state branch; ${who}. The loop's scoped identity must be set (its token in GH_TOKEN or the loop's gh login) before resume or run`;
}
