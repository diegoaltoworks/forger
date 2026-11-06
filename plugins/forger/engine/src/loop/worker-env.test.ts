import {describe, expect, test} from 'bun:test';

import {workerEnv, workerIdentity} from './worker-env';

describe('worker environment', () => {
  test('the identity reads back what the engine set', () => {
    expect(workerIdentity(workerEnv('issue-7', 4))).toEqual({ticket: 'issue-7', iteration: 4});
    expect(workerIdentity(workerEnv(null, 2))).toEqual({ticket: null, iteration: 2});
  });
  test('the plugin root is exported when known and absent otherwise', () => {
    expect(workerEnv('t', 1, '/opt/p').FORGER_PLUGIN_ROOT).toBe('/opt/p');
    expect('FORGER_PLUGIN_ROOT' in workerEnv('t', 1)).toBe(false);
  });
  test('the worker\'s environment carries the run\'s deadline', () => {
    const d = new Date('2030-01-02T03:04:05.000Z');
    expect(workerEnv('t', 1, undefined, d).FORGER_DEADLINE).toBe('2030-01-02T03:04:05.000Z');
    expect('FORGER_DEADLINE' in workerEnv('t', 1)).toBe(false);
  });
  test('a process the engine did not start is no worker', () => {
    expect(workerIdentity({})).toBeNull();
    expect(workerIdentity({FORGER_ROLE: 'supervisor'})).toBeNull();
  });
});
