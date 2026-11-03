import {describe, expect, test} from 'bun:test';

import {decideHalt, statusBody, type HaltDecision} from './halt-label';
import {defaultState} from './state';

describe('decideHalt', () => {
  test.each<[string, boolean, string | null, string | null, HaltDecision]>([
    ['nothing set', false, null, null, {halted: false}],
    ['label only, with a reason', true, 'bad CI', null, {halted: true, source: 'label', reason: 'bad CI'}],
    ['label only, no reason', true, null, null, {halted: true, source: 'label', reason: 'halted by the halted label'}],
    ['label only, blank reason', true, '  ', null, {halted: true, source: 'label', reason: 'halted by the halted label'}],
    ['file only', false, null, 'Halted: x\n', {halted: true, source: 'file', reason: 'Halted: x'}],
    ['empty file still halts', false, null, '', {halted: true, source: 'file', reason: 'HALT file'}],
    ['both', true, 'why', 'Halted: x', {halted: true, source: 'both', reason: 'why'}],
  ])('%s', (_name, label, labelReason, file, expected) => {
    expect(decideHalt({label, labelReason, file})).toEqual(expected);
  });
});

describe('statusBody', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  test('running says how to halt', () => {
    const body = statusBody(defaultState(), false, now);
    expect(body).toContain('Loop: running');
    expect(body).toContain('Add the `halted` label');
    expect(body).toContain('Updated 2026-01-01T00:00:00.000Z');
  });
  test('halted says how to resume and shows the last error', () => {
    const body = statusBody({...defaultState(), last_error: 'boom'}, true, now);
    expect(body).toContain('Loop: halted');
    expect(body).toContain('Last error: boom');
    expect(body).toContain('Remove the `halted` label to resume');
  });
});
