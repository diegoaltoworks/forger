import {describe, expect, test} from 'bun:test';

import {workerEnv, workerIdentity} from './worker-env';

describe('worker environment', () => {
  test('the identity reads back what the engine set', () => {
    expect(workerIdentity(workerEnv('issue-7', 4))).toEqual({ticket: 'issue-7', iteration: 4});
    expect(workerIdentity(workerEnv(null, 2))).toEqual({ticket: null, iteration: 2});
  });
  test('a process the engine did not start is no worker', () => {
    expect(workerIdentity({})).toBeNull();
    expect(workerIdentity({FORGER_ROLE: 'supervisor'})).toBeNull();
  });
});
