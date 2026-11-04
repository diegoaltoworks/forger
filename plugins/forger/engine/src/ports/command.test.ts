import {describe, expect, test} from 'bun:test';

import {capturing} from './command';

describe('capturing', () => {
  test('sees a plain runner that returns as one that succeeded', () => {
    expect(capturing(() => 'out')('x')).toEqual({stdout: 'out', stderr: '', exitCode: 0});
  });

  test('sees a throw as a failure carrying its message', () => {
    const run = () => {
      throw new Error('gh: Not Found (HTTP 404)');
    };
    expect(capturing(run)('x')).toEqual({stdout: '', stderr: 'gh: Not Found (HTTP 404)', exitCode: 1});
  });
});
