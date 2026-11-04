import {describe, expect, test} from 'bun:test';

import {decideLease, holderPid, viewLease, type Lease, type LocalProbe} from './lease';

const lease: Lease = {
  holder: 'a',
  host: 'laptop',
  acquired_at: '2026-01-01T00:00:00.000Z',
  renewed_at: '2026-01-01T00:10:00.000Z',
  ttl_seconds: 900,
};
const at = (iso: string) => new Date(iso);

describe('decideLease', () => {
  test.each([
    ['no lease', null, 'b', '2026-01-01T00:11:00.000Z', {action: 'acquire'}],
    ['own lease, live', lease, 'a', '2026-01-01T00:11:00.000Z', {action: 'renew'}],
    ['own lease, expired', lease, 'a', '2026-01-01T09:00:00.000Z', {action: 'renew'}],
    [
      'live foreign lease',
      lease,
      'b',
      '2026-01-01T00:24:59.000Z',
      {action: 'refuse', holder: 'a', expiresAt: '2026-01-01T00:25:00.000Z'},
    ],
    [
      'expired at the boundary',
      lease,
      'b',
      '2026-01-01T00:25:00.000Z',
      {action: 'takeover', previousHolder: 'a', previousHost: 'laptop'},
    ],
    [
      'expired foreign lease',
      lease,
      'b',
      '2026-01-01T03:00:00.000Z',
      {action: 'takeover', previousHolder: 'a', previousHost: 'laptop'},
    ],
    ['garbage: a string', 'nope', 'b', '2026-01-01T00:11:00.000Z', {action: 'acquire'}],
    ['garbage: missing fields', {holder: 'a'}, 'b', '2026-01-01T00:11:00.000Z', {action: 'acquire'}],
    [
      'garbage: bad time',
      {...lease, renewed_at: 'yesterday'},
      'b',
      '2026-01-01T00:11:00.000Z',
      {action: 'acquire'},
    ],
    [
      'garbage: zero ttl',
      {...lease, ttl_seconds: 0},
      'b',
      '2026-01-01T00:11:00.000Z',
      {action: 'acquire'},
    ],
  ])('%s', (_name, input, self, now, expected) => {
    expect(decideLease(input, self, at(now))).toEqual(expected as never);
  });

  test('does not read the clock: same inputs, same answer', () => {
    const now = at('2026-01-01T00:11:00.000Z');
    expect(decideLease(lease, 'b', now)).toEqual(decideLease(lease, 'b', now));
  });
});

describe('a lease held by a dead local engine', () => {
  const mine: Lease = {...lease, holder: 'laptop:4242:ab12cd34', host: 'laptop'};
  const now = at('2026-01-01T00:11:00.000Z');
  const local = (alive: boolean): {host: string; isAlive: () => boolean} => ({host: 'laptop', isAlive: () => alive});

  test('is taken over before it expires', () => {
    expect(decideLease(mine, 'b', now, local(false))).toEqual({action: 'takeover', previousHolder: mine.holder, previousHost: 'laptop'});
  });
  test('is refused while its pid lives', () => {
    expect(decideLease(mine, 'b', now, local(true)).action).toBe('refuse');
  });
  test('from another host is refused though the pid is gone here', () => {
    expect(decideLease(mine, 'b', now, {host: 'desktop', isAlive: () => false}).action).toBe('refuse');
  });
  test('a holder without a pid is left to expire', () => {
    expect(decideLease({...mine, holder: 'odd'}, 'b', now, local(false)).action).toBe('refuse');
  });
  test('holderPid reads host:pid:nonce', () => {
    expect(holderPid('laptop:4242:ab12cd34')).toBe(4242);
    expect(holderPid('odd')).toBe(null);
  });
});

describe('viewLease', () => {
  const probe = (host: string, alive: boolean): LocalProbe => ({host, isAlive: () => alive});
  const mine: Lease = {...lease, holder: 'laptop:4242:ab12cd34', host: 'laptop'};
  const now = at('2026-01-01T00:11:00.000Z');
  test.each([
    ['none', null, probe('laptop', true), 'none'],
    ['own live', mine, probe('laptop', true), 'own'],
    ['stale local', mine, probe('laptop', false), 'stale_local'],
    ['live elsewhere', mine, probe('desktop', false), 'live_elsewhere'],
    ['expired', {...mine, renewed_at: '2025-01-01T00:00:00.000Z'}, probe('desktop', false), 'expired'],
  ])('%s', (_n, input, probe, state) => {
    expect(viewLease(input, now, probe).state).toBe(state as never);
  });
  test('reports holder and expiry', () => {
    expect(viewLease(mine, now, probe('desktop', true))).toEqual({
      state: 'live_elsewhere',
      holder: mine.holder,
      host: 'laptop',
      expires_at: '2026-01-01T00:25:00.000Z',
    });
  });
});
