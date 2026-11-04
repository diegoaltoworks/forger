/**
 * The cross-machine lease (ADR 0015): who may run the loop now. Pure - the
 * clock is an input and nothing is read or written here.
 */

import type {Lease} from '../ports';

export type {Lease};

export type LeaseDecision =
  | {action: 'acquire'}
  | {action: 'renew'}
  | {action: 'refuse'; holder: string; expiresAt: string}
  | {action: 'takeover'; previousHolder: string; previousHost: string};

function parseLease(value: unknown): Lease | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const {holder, host, acquired_at, renewed_at, ttl_seconds} = v;
  if (typeof holder !== 'string' || holder === '') return null;
  if (typeof host !== 'string') return null;
  if (typeof acquired_at !== 'string' || typeof renewed_at !== 'string') return null;
  if (Number.isNaN(Date.parse(renewed_at))) return null;
  if (typeof ttl_seconds !== 'number' || !Number.isFinite(ttl_seconds) || ttl_seconds <= 0) {
    return null;
  }
  return {holder, host, acquired_at, renewed_at, ttl_seconds};
}

/** What tells a lease held by this machine's dead engine from a live one. */
export interface LocalProbe {
  host: string;
  isAlive: (pid: number) => boolean;
}

/** The pid inside a holder id of the form `host:pid:nonce`, or null when it has another shape. */
export function holderPid(holder: string): number | null {
  const m = /:(\d+):[^:]*$/.exec(holder);
  return m ? Number(m[1]) : null;
}

/** True when this machine holds the lease for a pid that is gone: the holder cannot renew it. */
function heldByDeadLocal(lease: Lease, local: LocalProbe | undefined): boolean {
  if (!local || lease.host !== local.host) return false;
  const pid = holderPid(lease.holder);
  return pid !== null && !local.isAlive(pid);
}

export type LeaseView =
  | {state: 'none'}
  | {state: 'own' | 'live_elsewhere' | 'stale_local' | 'expired'; holder: string; host: string; expires_at: string};

/** What `orient` reports about the stored lease, seen from this machine. */
export function viewLease(lease: unknown, now: Date, local: LocalProbe): LeaseView {
  const current = parseLease(lease);
  if (current === null) return {state: 'none'};
  const expiresMs = Date.parse(current.renewed_at) + current.ttl_seconds * 1000;
  const base = {holder: current.holder, host: current.host, expires_at: new Date(expiresMs).toISOString()};
  if (now.getTime() >= expiresMs) return {state: 'expired', ...base};
  if (heldByDeadLocal(current, local)) return {state: 'stale_local', ...base};
  return {state: current.host === local.host ? 'own' : 'live_elsewhere', ...base};
}

/**
 * A lease is live while now - renewed_at < ttl_seconds. A missing or malformed
 * record holds nobody, so it is acquired rather than refused: a corrupt file
 * must not lock the loop out for good.
 */
export function decideLease(lease: unknown, self: string, now: Date, local?: LocalProbe): LeaseDecision {
  const current = parseLease(lease);
  if (current === null) return {action: 'acquire'};
  if (current.holder === self) return {action: 'renew'};
  const expiresMs = Date.parse(current.renewed_at) + current.ttl_seconds * 1000;
  if (now.getTime() < expiresMs && !heldByDeadLocal(current, local)) {
    return {action: 'refuse', holder: current.holder, expiresAt: new Date(expiresMs).toISOString()};
  }
  return {action: 'takeover', previousHolder: current.holder, previousHost: current.host};
}

/** The record a decision writes: a renewal keeps the original acquisition time. */
export function leaseFor(
  decision: LeaseDecision,
  existing: unknown,
  req: {self: string; host: string; ttlSeconds: number; now: Date}
): Lease {
  const now = req.now.toISOString();
  const kept = decision.action === 'renew' ? parseLease(existing) : null;
  return {
    holder: req.self,
    host: req.host,
    acquired_at: kept?.acquired_at ?? now,
    renewed_at: now,
    ttl_seconds: req.ttlSeconds,
  };
}
