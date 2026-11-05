/**
 * The engine runs its own code from the loop's checkout, so a base branch that
 * sits behind its remote means every restart runs old code. These are the pure
 * decisions over the git facts a caller gathered.
 */

import type {CommandRunner} from '../ports';

export interface BaseSync {
  /** Commits `origin/<base>` has that the local base branch lacks; null when it could not be told. */
  behind: number | null;
  /** The working tree has no uncommitted changes. */
  clean: boolean;
}

/** One line naming the gap and the command that closes it. */
export function behindBaseMessage(base: string, behind: number): string {
  return `the checkout's ${base} is ${behind} commit(s) behind origin/${base}, so the engine runs old code; run \`git pull --ff-only origin ${base}\` in the checkout`;
}

/** The anomaly `orient` reports: only while no engine is alive, since a live one cannot be updated under itself. */
export function behindBaseAnomaly(sync: BaseSync | undefined, base: string, engineAlive: boolean): string | null {
  if (engineAlive || !sync || sync.behind === null || sync.behind <= 0) return null;
  return behindBaseMessage(base, sync.behind);
}

/** The refusal `run` gives: a behind base branch in a clean checkout; a dirty one is left alone as it may be mid-work. */
export function behindBaseRefusal(sync: BaseSync, base: string): string | null {
  if (sync.behind === null || sync.behind <= 0 || !sync.clean) return null;
  return behindBaseMessage(base, sync.behind);
}

/** Reads the facts; a fetch or compare that fails leaves `behind` unknown. */
export function readBaseSync(run: CommandRunner, base: string): BaseSync {
  let behind: number | null = null;
  try {
    run(`git fetch --quiet origin ${base}`);
    const n = Number(run(`git rev-list --count ${base}..origin/${base}`).trim());
    behind = Number.isInteger(n) ? n : null;
  } catch {
    behind = null;
  }
  let clean = false;
  try {
    clean = run('git status --porcelain').trim() === '';
  } catch {
    clean = false;
  }
  return {behind, clean};
}

/** The message for a state-branch write that was refused, naming who pushed. */
export function stateWriteFailure(identity: string | null): string {
  const who = identity ? `the GitHub identity in use is "${identity}"` : 'the GitHub identity in use could not be read';
  return `forger: could not write the state branch; ${who}. The loop's scoped identity must be set (its token in GH_TOKEN or the loop's gh login) before resume or run`;
}
