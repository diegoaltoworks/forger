/**
 * Where the machine-written loop files live (ADR 0015): the state record, the
 * event log and the lease. The loop is written against this shape; a local
 * adapter keeps them in files beside the engine, a git adapter keeps them on
 * the state branch. Types only.
 */

/** Who may run the loop now: the record kept in the store (ADR 0015). */
export interface Lease {
  holder: string;
  host: string;
  acquired_at: string;
  renewed_at: string;
  ttl_seconds: number;
}

/** The outcome of asking for the lease. */
export type LeaseClaim =
  | {ok: true; action: 'acquire' | 'renew'; lease: Lease}
  | {ok: true; action: 'takeover'; lease: Lease; previousHolder: string; previousHost: string}
  | {ok: false; reason: 'held'; holder: string; expiresAt: string}
  /** The write could not be made to stick: a renewal that fails is a lost lease. */
  | {ok: false; reason: 'lost'};

export interface LeaseRequest {
  self: string;
  host: string;
  ttlSeconds: number;
  now: Date;
  /** Liveness of a pid on this machine; lets a lease held here by a dead pid be taken over. */
  isAlive?: (pid: number) => boolean;
}

export interface StateStore {
  /** The stored state record's text, or null when there is none. */
  readState(): string | null;
  writeState(text: string): void;
  /** Appends one event line (no trailing newline needed) for the UTC day of `at`. */
  appendEvent(line: string, at: Date): void;
  /** Every event line stored, oldest first, as one text. */
  readEvents(): string;
  /** Acquires, renews or takes over the lease, or says why it could not. */
  claimLease(request: LeaseRequest): LeaseClaim;
  /** The stored lease record, or null when there is none. */
  readLease(): unknown;
  /** Frees the lease if `self` holds it. */
  releaseLease(self: string): void;
}

/** What a migration needs of the state branch beyond the loop's own reads and writes. */
export interface StateBranch {
  /** Whether the branch already exists on the remote. */
  exists(): boolean;
  /** The lease record kept on the branch, or null when there is none. */
  readLease(): unknown;
  /** Creates the branch (orphan) with these files as its first commit; false when the push was refused. */
  seed(files: Record<string, string>, message: string): boolean;
}

/** The UTC day an event belongs to, `YYYY-MM-DD`. */
export function eventDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}
