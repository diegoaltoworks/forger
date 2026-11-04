import {describe, expect, test} from 'bun:test';

import {attemptReason, onContractFailure, type ContractAction} from './contract-policy';

describe('onContractFailure', () => {
  const table: Array<[number, ContractAction, 'unclear' | undefined]> = [
    [1, 'retry', undefined],
    [2, 'builtin', undefined],
    [3, 'decline', 'unclear'],
    [4, 'decline', 'unclear'],
  ];
  test.each(table)('after failed attempt %d the step is %s', (attempt, action, reason) => {
    expect(onContractFailure(attempt, 'review')).toEqual({slot: 'review', attempt, action, ...(reason ? {reason} : {})});
  });
});

describe('attemptReason', () => {
  test('names the slot, the attempt and the problems', () => {
    expect(attemptReason('review', 2, ['a', 'b'])).toBe('review attempt 2: a; b');
    expect(attemptReason('review', 1, [])).toBe('review attempt 1: ok');
  });
});
