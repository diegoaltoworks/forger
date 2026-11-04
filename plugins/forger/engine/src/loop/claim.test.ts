import {describe, expect, test} from 'bun:test';

import {parseClaim} from './claim';

describe('parseClaim', () => {
  test('complete', () => {
    expect(parseClaim('done\n<process>complete</process>')).toEqual({
      claim: 'complete',
      stopReason: null,
    });
  });

  test('stop with a reason', () => {
    expect(parseClaim('<process>stop</process>\nblocked: needs API keys\n')).toEqual({
      claim: 'stop',
      stopReason: 'needs API keys',
    });
  });

  test('stop without a reason gets the default', () => {
    expect(parseClaim('<process>stop</process>').stopReason).toBe(
      'Agent signaled stop - blocked or no actionable work'
    );
  });

  test('stop then complete is complete', () => {
    const out = '<process>stop</process>\nNot finished: waiting on verify\n\nmerged it\n<process>complete</process>';
    expect(parseClaim(out)).toEqual({claim: 'complete', stopReason: null});
  });

  test('complete then stop is stop', () => {
    expect(parseClaim('<process>complete</process> <process>stop</process> needs a key').claim).toBe('stop');
  });

  test('the stop reason is the text after the tag, up to the next blank line', () => {
    const out = '<process>stop</process>\nThe ticket is too large\nfor one run.\n\nOther notes here.';
    expect(parseClaim(out).stopReason).toBe('The ticket is too large for one run.');
  });

  test('a later "because" elsewhere is not taken as the reason', () => {
    const out =
      '<process>stop</process>\n\nSummary: its file slots do not resolve, because they need the plugin install root.';
    expect(parseClaim(out).stopReason).toBe('Agent signaled stop - blocked or no actionable work');
  });

  test('the text before the tag is never the reason', () => {
    const out = 'blocked: an old note\n<process>stop</process>\nneeds API keys';
    expect(parseClaim(out).stopReason).toBe('needs API keys');
  });

  test('a long reason is capped', () => {
    const reason = parseClaim(`<process>stop</process> ${'x'.repeat(1000)}`).stopReason ?? '';
    expect(reason.length).toBe(300);
    expect(reason.endsWith('...')).toBe(true);
  });

  test('no signal', () => {
    expect(parseClaim('merged and committed')).toEqual({claim: null, stopReason: null});
  });
});
