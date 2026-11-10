import {describe, expect, test} from 'bun:test';

import type {TerminalEvent} from '../events';
import {deliveryOutcome, failedDeliveries, failureBody, prReason, reasonPr, tailOf} from './outcome';

const ev = (event: string, pr: number): TerminalEvent => ({event, at: 't', iteration: 1, ticket: null, reason: prReason(pr, 'x')} as TerminalEvent);

describe('delivery outcome', () => {
  test('the reason names its PR and reads back', () => {
    expect(reasonPr(prReason(12, 'ok'))).toBe(12);
    expect(reasonPr(prReason(null, 'ok'))).toBeNull();
    expect(reasonPr(null)).toBeNull();
  });

  test('the latest event for the PR decides', () => {
    expect(deliveryOutcome([ev('delivered', 3)], 3)).toBe('delivered');
    expect(deliveryOutcome([ev('delivery_failed', 3)], 3)).toBe('failed');
    expect(deliveryOutcome([ev('delivery_failed', 3), ev('rolled_back', 3)], 3)).toBe('rolled_back');
    expect(deliveryOutcome([ev('delivery_failed', 3), ev('rollback_failed', 3)], 3)).toBe('failed');
    expect(deliveryOutcome([ev('delivered', 4)], 3)).toBeNull();
  });

  test('a failed delivery waits until a later one passes or a rollback lands', () => {
    expect(failedDeliveries([ev('delivery_failed', 3)])).toEqual([3]);
    expect(failedDeliveries([ev('delivery_failed', 3), ev('delivery_failed', 3)])).toEqual([3]);
    expect(failedDeliveries([ev('delivery_failed', 3), ev('delivered', 4)])).toEqual([]);
    expect(failedDeliveries([ev('delivery_failed', 3), ev('rolled_back', 3)])).toEqual([]);
    expect(failedDeliveries([ev('delivery_failed', 3), ev('rollback_failed', 3)])).toEqual([3]);
  });

  test('the issue body links the PR and carries the end of the output', () => {
    const output = Array.from({length: 100}, (_, i) => `line ${i}`).join('\n');
    const body = failureBody(9, 'check', '`c` exited 1', output);
    expect(body).toContain('#9');
    expect(body).toContain('line 99');
    expect(body).not.toContain('line 10\n');
    expect(failureBody(null, 'check', 'd', '')).toContain('A merged change');
    expect(tailOf('a\nb\nc', 2)).toBe('b\nc');
  });
});
