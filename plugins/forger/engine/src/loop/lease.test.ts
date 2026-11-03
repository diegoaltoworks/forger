import {describe, expect, test} from 'bun:test';

import {decideLease, type Lease} from './lease';

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
