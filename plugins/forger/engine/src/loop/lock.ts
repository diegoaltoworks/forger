/**
 * The single-runner lock: a file holding the runner's own pid. A second runner
 * on the same repo re-runs tickets the first is working, so a start refuses
 * while the holder is alive and takes over a lock whose pid is dead. The
 * decision is pure; the file and the liveness probe sit behind small seams.
 */

import {existsSync, readFileSync, unlinkSync, writeFileSync} from 'fs';

export type LockDecision =
  | {action: 'acquire'}
  | {action: 'takeover'; stalePid: number | null}
  | {action: 'refuse'; holder: number};

export function parsePid(content: string | null): number | null {
  if (content === null) return null;
  const n = Number(content.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** An unreadable or garbage lock holds nothing, so it is taken over. */
export function decideLock(
  content: string | null,
  ownPid: number,
  isAlive: (pid: number) => boolean
): LockDecision {
  if (content === null) return {action: 'acquire'};
  const pid = parsePid(content);
  if (pid === null) return {action: 'takeover', stalePid: null};
  if (pid === ownPid) return {action: 'acquire'};
  return isAlive(pid) ? {action: 'refuse', holder: pid} : {action: 'takeover', stalePid: pid};
}

/** Signal 0 probes without delivering; EPERM means the process exists. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export type LockResult =
  | {ok: true; tookOver: number | null | undefined}
  | {ok: false; holder: number};

export class RunnerLock {
  constructor(
    private file: string,
    private ownPid: number = process.pid,
    private isAlive: (pid: number) => boolean = pidAlive
  ) {}

  /** The pid in the lock file, or null when there is none. */
  holder(): number | null {
    return parsePid(this.read());
  }

  /** The holder's pid when it is alive. */
  liveHolder(): number | null {
    const pid = this.holder();
    return pid !== null && this.isAlive(pid) ? pid : null;
  }

  acquire(): LockResult {
    const decision = decideLock(this.read(), this.ownPid, this.isAlive);
    if (decision.action === 'refuse') return {ok: false, holder: decision.holder};
    if (decision.action === 'takeover') this.remove();
    try {
      // 'wx' fails if another runner created the file after our read.
      writeFileSync(this.file, String(this.ownPid), {flag: 'wx'});
    } catch {
      const holder = this.holder();
      if (holder !== null && holder !== this.ownPid) return {ok: false, holder};
      writeFileSync(this.file, String(this.ownPid));
    }
    return {ok: true, tookOver: decision.action === 'takeover' ? decision.stalePid : undefined};
  }

  /** Removes the lock only if this runner still holds it. */
  release(): void {
    if (this.holder() === this.ownPid) this.remove();
  }

  private read(): string | null {
    return existsSync(this.file) ? readFileSync(this.file, 'utf-8') : null;
  }

  private remove(): void {
    if (existsSync(this.file)) unlinkSync(this.file);
  }
}
