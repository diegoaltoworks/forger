import {describe, expect, test} from 'bun:test';
import {haltClearCounts, parseHaltClear, uncausedClears} from './halt-clear';
import {terminalEvent} from './events';

const clear = (extra: {cause?: number | null; not_a_defect?: string | null}) => terminalEvent('halt_cleared', 1, null, 'boom', new Date(0), extra);

describe('parseHaltClear', () => {
  test('neither form is refused', () => {
    expect(parseHaltClear(undefined, undefined)).toEqual({ok: false, problem: expect.stringContaining('needs a reason')});
  });
  test('both forms are refused', () => {
    expect(parseHaltClear('3', 'outage').ok).toBe(false);
  });
  test('a cause is an issue number', () => {
    expect(parseHaltClear('#12', undefined)).toEqual({ok: true, why: {cause: 12, notADefect: null}});
    expect(parseHaltClear('abc', undefined).ok).toBe(false);
    expect(parseHaltClear('0', undefined).ok).toBe(false);
  });
  test('a not-a-defect reason is one non-empty line', () => {
    expect(parseHaltClear(undefined, ' outage ')).toEqual({ok: true, why: {cause: null, notADefect: 'outage'}});
    expect(parseHaltClear(undefined, '  ').ok).toBe(false);
    expect(parseHaltClear(undefined, 'a\nb').ok).toBe(false);
  });
});

describe('clears', () => {
  const events = [clear({cause: 4, not_a_defect: null}), clear({cause: null, not_a_defect: 'outage'}), clear({cause: null, not_a_defect: 'outage'}), clear({cause: null, not_a_defect: null}), clear({})];
  test('are counted by how they were explained', () => {
    expect(haltClearCounts(events)).toEqual({with_cause: 1, not_a_defect: 2, uncaused: 2, reasons: [{reason: 'outage', count: 2}]});
  });
  test('uncaused ones are listed', () => {
    expect(uncausedClears(events)).toHaveLength(2);
  });
});
