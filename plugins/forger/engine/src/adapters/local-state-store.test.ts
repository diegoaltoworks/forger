import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {localStateStore} from './local-state-store';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'forger-local-'));
  dirs.push(dir);
  const paths = {state: join(dir, 'state.json'), events: join(dir, 'events.jsonl'), lease: join(dir, 'lease.json')};
  return {paths, store: localStateStore(paths)};
}
const at = new Date('2026-01-01T00:00:00Z');
const req = (self: string, now = at) => ({self, host: 'h', ttlSeconds: 900, now});

describe('localStateStore', () => {
  test('state is the file it always was', () => {
    const {paths, store} = setup();
    expect(store.readState()).toBeNull();
    store.writeState('{"iteration":1}');
    expect(readFileSync(paths.state, 'utf-8')).toBe('{"iteration":1}');
    expect(store.readState()).toBe('{"iteration":1}');
  });

  test('events append to the one events file', () => {
    const {paths, store} = setup();
    store.appendEvent('{"a":1}', at);
    store.appendEvent('{"b":1}\n', new Date('2026-02-01T00:00:00Z'));
    expect(readFileSync(paths.events, 'utf-8')).toBe('{"a":1}\n{"b":1}\n');
    expect(store.readEvents()).toBe('{"a":1}\n{"b":1}\n');
  });

  test('lease: acquire, refuse, renew keeping acquired_at, release', () => {
    const {paths, store} = setup();
    expect(store.claimLease(req('a'))).toMatchObject({ok: true, action: 'acquire'});
    expect(store.claimLease(req('b'))).toMatchObject({ok: false, reason: 'held', holder: 'a'});
    const later = new Date('2026-01-01T00:05:00Z');
    const renewed = store.claimLease(req('a', later));
    expect(renewed).toMatchObject({ok: true, action: 'renew'});
    expect(renewed.ok && renewed.lease.acquired_at).toBe(at.toISOString());
    store.releaseLease('b');
    expect(existsSync(paths.lease)).toBe(true);
    store.releaseLease('a');
    expect(existsSync(paths.lease)).toBe(false);
  });

  test('a corrupt lease file holds nobody', () => {
    const {paths, store} = setup();
    writeFileSync(paths.lease, 'not json');
    expect(store.claimLease(req('a'))).toMatchObject({ok: true, action: 'acquire'});
  });
});
