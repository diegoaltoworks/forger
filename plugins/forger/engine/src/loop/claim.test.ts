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

  test('stop wins over complete', () => {
    expect(parseClaim('<process>complete</process> <process>stop</process>').claim).toBe('stop');
  });

  test('no signal', () => {
    expect(parseClaim('merged and committed')).toEqual({claim: null, stopReason: null});
  });
});
