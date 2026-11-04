/**
 * An in-memory StateStore for tests of the loop: same contract as the real
 * adapters, nothing on disk.
 */

import {decideLease, leaseFor, type Lease} from '../loop';
import {eventDay, type LeaseClaim, type LeaseRequest, type StateStore} from '../ports';

export function memoryStateStore(): StateStore & {lease: Lease | null} {
  let state: string | null = null;
  const days = new Map<string, string>();
  const store = {
    lease: null as Lease | null,
    readState: () => state,
    writeState(text: string) {
      state = text;
    },
    appendEvent(line: string, at: Date) {
      const day = eventDay(at);
      days.set(day, `${days.get(day) ?? ''}${line.replace(/\n$/, '')}\n`);
    },
    readEvents: () =>
      [...days.keys()]
        .sort()
        .map(d => days.get(d))
        .join(''),
    claimLease(req: LeaseRequest): LeaseClaim {
      const decision = decideLease(store.lease, req.self, req.now, req.isAlive && {host: req.host, isAlive: req.isAlive});
      if (decision.action === 'refuse') {
        return {ok: false, reason: 'held', holder: decision.holder, expiresAt: decision.expiresAt};
      }
      const lease = leaseFor(decision, store.lease, req);
      store.lease = lease;
      return decision.action === 'takeover' ? {ok: true, ...decision, lease} : {ok: true, action: decision.action, lease};
    },
    readLease: () => store.lease,
    releaseLease(self: string) {
      if (store.lease?.holder === self) store.lease = null;
    },
  };
  return store;
}
