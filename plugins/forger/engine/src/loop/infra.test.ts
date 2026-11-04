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
    ['delivery', 'Warning: no stdin data received in 3s, proceeding without it.', 'a worker that got no prompt'],
    ['delivery', 'Error: Input must be provided either through stdin or as a prompt argument when using --print', 'a worker refusing an empty prompt'],
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

  test('a prompt the engine could not deliver is an infrastructure error whatever the output says', () => {
    const c = classifyExit(1, 'tests failed: 3', false, 'the prompt could not be written: ENOSPC');
    expect(c).toEqual({
      kind: 'infrastructure',
      category: 'delivery',
      reason: 'Infrastructure error (delivery): the prompt did not reach the worker: the prompt could not be written: ENOSPC',
    });
  });

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
