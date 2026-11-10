import {describe, expect, test} from 'bun:test';

import {computeJourneyShare, formatJourneyShare} from './journey-share';

const journeys = [
  {name: 'sign in', paths: ['src/auth/**']},
  {name: 'checkout', paths: ['src/cart/**', 'src/pay/*.ts']},
];

describe('computeJourneyShare', () => {
  test('a merged PR that changes a file under a journey\'s paths counts for that journey', () => {
    const s = computeJourneyShare([{number: 1, files: ['src/auth/login.ts', 'README.md']}], journeys);
    expect(s.by_journey).toEqual({'sign in': 1, checkout: 0});
    expect(s.touched_a_journey).toBe(1);
  });

  test('a merged PR that touches no journey counts as upkeep', () => {
    const s = computeJourneyShare([{number: 1, files: ['docs/a.md']}, {number: 2, files: []}], journeys);
    expect(s).toEqual({merged: 2, touched_a_journey: 0, by_journey: {'sign in': 0, checkout: 0}, upkeep: 2});
  });

  test('a PR that touches two journeys counts once in the total and once for each', () => {
    const s = computeJourneyShare([{number: 1, files: ['src/auth/a.ts', 'src/cart/b.ts', 'src/cart/c.ts']}, {number: 2, files: ['x']}], journeys);
    expect(s).toEqual({merged: 2, touched_a_journey: 1, by_journey: {'sign in': 1, checkout: 1}, upkeep: 1});
  });

  test('the report line names the split', () => {
    const s = computeJourneyShare([{number: 1, files: ['src/pay/p.ts']}, {number: 2, files: ['x']}], journeys);
    expect(formatJourneyShare(s)).toBe('journeys: 1 of 2 merged PR(s) changed a journey, 1 upkeep: sign in 0, checkout 1');
  });
});
