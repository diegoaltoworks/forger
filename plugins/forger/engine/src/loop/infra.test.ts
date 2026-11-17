import {describe, expect, test} from 'bun:test';

import {classifyExit, isUnreachable, UNREACHABLE_BOUND_MS, UNREACHABLE_CAP_MS, UNREACHABLE_FIRST_WAIT_MS, unreachableWaitMs} from './infra';

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

describe('an unreachable tracker', () => {
  test('what gh prints when it cannot connect is an unreachable tracker, and any other failure is not', () => {
    for (const said of [
      'error connecting to api.github.com',
      'dial tcp: lookup api.github.com: no such host',
      'Post "https://api.github.com/graphql": read tcp 1.2.3.4:5->6.7.8.9:443: connection reset by peer',
      'could not resolve host: api.github.com',
      'HTTP 502: Bad Gateway (https://api.github.com/graphql)',
      'HTTP 503: Service Unavailable',
      'HTTP 504: Gateway Timeout',
    ]) {
      expect(isUnreachable(said)).toBe(true);
    }
    for (const said of ['', 'HTTP 404: Not Found', 'HTTP 401: Bad credentials', 'API rate limit exceeded', 'could not parse the query']) {
      expect(isUnreachable(said)).toBe(false);
    }
  });

  test('the wait for an unreachable tracker grows to its cap, stays there, and ends at its bound', () => {
    const waits: number[] = [];
    for (let n = 0; unreachableWaitMs(n) !== null; n++) waits.push(unreachableWaitMs(n) as number);
    expect(waits[0]).toBe(UNREACHABLE_FIRST_WAIT_MS);
    expect(waits[1]).toBe(UNREACHABLE_FIRST_WAIT_MS * 2);
    expect(Math.max(...waits)).toBe(UNREACHABLE_CAP_MS);
    expect(waits.slice(waits.indexOf(UNREACHABLE_CAP_MS)).every(w => w === UNREACHABLE_CAP_MS)).toBe(true);
    expect(waits.every((w, i) => i === 0 || w >= waits[i - 1])).toBe(true);
    const total = waits.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(UNREACHABLE_BOUND_MS);
    expect(total - waits[waits.length - 1]).toBeLessThan(UNREACHABLE_BOUND_MS);
  });
});
