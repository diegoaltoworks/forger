import {describe, expect, test} from 'bun:test';

import {classifyExit} from './infra';

describe('classifyExit', () => {
  const cases: [string, string, string][] = [
    ['authentication', 'Invalid API key - Please run /login', 'a bad key'],
    ['authentication', 'OAuth token has expired', 'an expired login'],
    ['authentication', 'API Error: 401 {"type":"authentication_error"}', 'an auth error body'],
    ['billing', 'Credit balance is too low', 'an empty balance'],
    ['billing', 'Claude usage limit reached', 'a usage cap'],
    ['network', 'connect ECONNREFUSED 1.2.3.4:443', 'a refused connection'],
    ['network', 'getaddrinfo ENOTFOUND api.example.com', 'a failed lookup'],
  ];
  for (const [category, output, label] of cases) {
    test(`${label} is an infrastructure error (${category})`, () => {
      const c = classifyExit(1, output, false);
      expect(c.kind).toBe('infrastructure');
      if (c.kind === 'infrastructure') {
        expect(c.category).toBe(category as typeof c.category);
        expect(c.reason).toContain(category);
      }
    });
  }

  test('an ordinary failure is a worker failure', () => {
    expect(classifyExit(1, 'tests failed: 3', false)).toEqual({kind: 'worker'});
  });

  test('a clean exit quoting an error is a worker run', () => {
    expect(classifyExit(0, 'the log said Invalid API key', false)).toEqual({kind: 'worker'});
  });

  test('a timeout is a worker failure even with a matching line', () => {
    expect(classifyExit(1, 'ETIMEDOUT', true)).toEqual({kind: 'worker'});
  });
});
