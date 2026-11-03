import {describe, expect, test} from 'bun:test';

import {formatIterationLog} from './iteration-log';

const base = {
  iteration: 4,
  ticket: 'engine_timeout_kills_group',
  elapsedSeconds: 2712,
  exitCode: 0,
  signal: null,
  timedOut: false,
  timeoutMinutes: 45,
  output: 'worker output\n',
};

describe('formatIterationLog', () => {
  test('a finished run gets a header, then the captured output verbatim', () => {
    const log = formatIterationLog(base);
    expect(log).toBe(
      [
        '=== forger iteration 4 ===',
        'ticket: engine_timeout_kills_group',
        'elapsed: 2712s',
        'outcome: exited with code 0',
        '=== output ===',
        'worker output',
        '',
      ].join('\n')
    );
  });

  test('a timeout names the ticket, elapsed time, the limit and the signal', () => {
    const log = formatIterationLog({...base, timedOut: true, exitCode: 1, signal: 'SIGKILL'});
    expect(log).toContain('ticket: engine_timeout_kills_group');
    expect(log).toContain('elapsed: 2712s');
    expect(log).toContain('outcome: timed out after 45 minutes, ended by SIGKILL');
  });

  test('a run killed by a signal without a timeout says so', () => {
    const log = formatIterationLog({...base, exitCode: 1, signal: 'SIGTERM'});
    expect(log).toContain('outcome: ended by SIGTERM');
  });

  test('no ticket and no output are stated, not left blank', () => {
    const log = formatIterationLog({...base, ticket: null, output: ''});
    expect(log).toContain('ticket: none picked');
    expect(log.endsWith('=== output ===\n(no output captured)\n')).toBe(true);
  });

  test('output without a trailing newline still ends the log with one', () => {
    expect(formatIterationLog({...base, output: 'x'}).endsWith('x\n')).toBe(true);
  });

  test('names the engine pick when the worker took a different ticket', () => {
    const log = formatIterationLog({...base, ticket: 'other', enginePick: 'engine_timeout_kills_group'});
    expect(log).toContain('ticket: other\nengine pick: engine_timeout_kills_group\n');
  });

  test('prints the engine pick when it matches', () => {
    const log = formatIterationLog({...base, enginePick: 'engine_timeout_kills_group'});
    expect(log).toContain('engine pick: engine_timeout_kills_group');
  });

  test('the engine pick always prints, also when the worker took it', () => {
    const log = formatIterationLog({...base, enginePick: base.ticket});
    expect(log).toContain(`engine pick: ${base.ticket}`);
  });

  test('an engine with no pick prints none', () => {
    expect(formatIterationLog({...base, ticket: null, enginePick: null})).toContain('engine pick: none');
  });

  test('prints the decided status after the outcome, and omits it before one', () => {
    expect(formatIterationLog({...base, status: 'declined'})).toContain('outcome: exited with code 0\nstatus: declined\n');
    expect(formatIterationLog(base)).not.toContain('status:');
  });
});
