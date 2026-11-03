/**
 * The cross-machine lease (ADR 0015): who may run the loop now. Pure - the
 * clock is an input and nothing is read or written here.
 */

export interface Lease {
  holder: string;
  host: string;
  acquired_at: string;
  renewed_at: string;
  ttl_seconds: number;
}

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

/**
 * A lease is live while now - renewed_at < ttl_seconds. A missing or malformed
 * record holds nobody, so it is acquired rather than refused: a corrupt file
 * must not lock the loop out for good.
 */
export function decideLease(lease: unknown, self: string, now: Date): LeaseDecision {
  const current = parseLease(lease);
  if (current === null) return {action: 'acquire'};
  if (current.holder === self) return {action: 'renew'};
  const expiresMs = Date.parse(current.renewed_at) + current.ttl_seconds * 1000;
  if (now.getTime() < expiresMs) {
    return {action: 'refuse', holder: current.holder, expiresAt: new Date(expiresMs).toISOString()};
  }
  return {action: 'takeover', previousHolder: current.holder, previousHost: current.host};
}
