/**
 * The StateStore over files beside the engine: today's behaviour. The state
 * record and the event log are the files they always were; the lease is a
 * file of its own.
 */

import {appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync} from 'fs';

import {dirname, join} from 'path';

import type {WorkloopConfig} from '../config';
import {decideLease, leaseFor} from '../loop';
import type {LeaseClaim, LeaseRequest, StateStore} from '../ports';

export interface LocalStatePaths {
  state: string;
  events: string;
  lease: string;
}

function readJson(file: string): unknown {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export function localStateStore(paths: LocalStatePaths): StateStore {
  return {
    readState: () => (existsSync(paths.state) ? readFileSync(paths.state, 'utf-8') : null),
    writeState: text => writeFileSync(paths.state, text),
    appendEvent: line => appendFileSync(paths.events, line.endsWith('\n') ? line : `${line}\n`),
    readEvents: () => (existsSync(paths.events) ? readFileSync(paths.events, 'utf-8') : ''),
    claimLease(req: LeaseRequest): LeaseClaim {
      const existing = readJson(paths.lease);
      const decision = decideLease(existing, req.self, req.now, req.isAlive && {host: req.host, isAlive: req.isAlive});
      if (decision.action === 'refuse') {
        return {ok: false, reason: 'held', holder: decision.holder, expiresAt: decision.expiresAt};
      }
      const lease = leaseFor(decision, existing, req);
      writeFileSync(paths.lease, JSON.stringify(lease, null, 2));
      return decision.action === 'takeover' ? {ok: true, ...decision, lease} : {ok: true, action: decision.action, lease};
    },
    readLease: () => readJson(paths.lease),
    releaseLease(self) {
      const existing = readJson(paths.lease) as {holder?: string} | null;
      if (existing?.holder === self) unlinkSync(paths.lease);
    },
  };
}

/** The local store for a project: its configured state and events files, the lease beside the state. */
export function localStateFor(projectRoot: string, config: WorkloopConfig): StateStore {
  const state = join(projectRoot, config.paths.state);
  return localStateStore({state, events: join(projectRoot, config.paths.events), lease: join(dirname(state), 'lease.json')});
}
