import {describe, expect, test} from 'bun:test';

import {DEFAULT_READY_SECONDS, parseJourneysConfig, parsePid, startShellCommand, waitShellCommand} from './journeys';

const ok = {name: 'a', command: 'x', paths: ['src/**']};

describe('parseJourneysConfig', () => {
  test('defaults the ready wait and keeps start and ready', () => {
    const c = parseJourneysConfig(JSON.stringify({journeys: [ok], start: ' serve ', ready: 'up'}));
    expect(c).toMatchObject({start: 'serve', ready: 'up', ready_seconds: DEFAULT_READY_SECONDS});
  });

  test.each([
    ['not json', 'not valid JSON'],
    ['[]', 'must be an object'],
    ['{}', '"journeys" must be a list'],
    [JSON.stringify({journeys: [1]}), 'journeys[0] must be an object'],
    [JSON.stringify({journeys: [{command: 'x', paths: ['a']}]}), 'journeys[0] needs a "name"'],
    [JSON.stringify({journeys: [{name: 'n', command: 'x', paths: []}]}), 'journeys[0] ("n") needs "paths"'],
    [JSON.stringify({journeys: [ok, ok]}), 'two journeys are named "a"'],
    [JSON.stringify({journeys: [], start: ''}), '"start" must be'],
    [JSON.stringify({journeys: [], ready_seconds: 0}), '"ready_seconds"'],
  ])('rejects %s', (text, message) => expect(() => parseJourneysConfig(text)).toThrow(message));
});

describe('shell wrappers', () => {
  test('the start command survives single quotes', () => {
    expect(startShellCommand("echo 'hi'")).toContain(`'echo '\\''hi'\\'''`);
  });
  test('the pid is read from the output, and absent output has none', () => {
    expect(parsePid('noise\nforger-journey-pid:12\n')).toBe(12);
    expect(parsePid('')).toBeNull();
  });
  test('the wait polls the ready command for the configured seconds', () => {
    expect(waitShellCommand('up', 7)).toContain('-lt 7');
  });
});
