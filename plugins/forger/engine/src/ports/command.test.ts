import {describe, expect, test} from 'bun:test';

import {capturing} from './command';

describe('capturing', () => {
  test('sees a plain runner as one that never fails', () => {
    expect(capturing(() => 'out')('x')).toEqual({stdout: 'out', stderr: '', exitCode: 0});
  });
});
