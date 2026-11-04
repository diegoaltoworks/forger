import {describe, expect, test} from 'bun:test';

import {evidenceHolds, failedCitations, testResults, type CopyRecord} from './evidence-check';
import {logLine, parseCommandLog} from './run-logged';

const output = ['(pass) the engine refuses a red merge [1.2ms]', '(fail) the engine names the head', 'ok 3 - tap style passes', 'not ok 4 - tap style fails'].join('\n');
const record: CopyRecord = {
  fileLines: p => ({'src/a.ts': 10, 'docs/screenshots/empty.png': 1}[p] ?? null),
  commands: [
    {command: 'bun test', exit: 0, output},
    {command: 'bun run check', exit: 1, output: ''},
  ],
};
const holds = (kind: 'file' | 'test' | 'command' | 'screenshot' | 'check', ref: string) => evidenceHolds(record, {kind, ref});

describe('evidenceHolds', () => {
  test('file: exists, and the line is within it', () => {
    expect(holds('file', 'src/a.ts')).toBe(true);
    expect(holds('file', 'src/a.ts:10')).toBe(true);
    expect(holds('file', 'src/a.ts:11')).toBe(false);
    expect(holds('file', 'src/a.ts:0')).toBe(false);
    expect(holds('file', 'src/missing.ts')).toBe(false);
    expect(holds('file', '../outside.ts')).toBe(false);
    expect(holds('file', '/etc/passwd')).toBe(false);
  });

  test('test: appears in a recorded run, and passed', () => {
    expect(holds('test', 'refuses a red merge')).toBe(true);
    expect(holds('test', 'tap style passes')).toBe(true);
    expect(holds('test', 'names the head')).toBe(false);
    expect(holds('test', 'tap style fails')).toBe(false);
    expect(holds('test', 'never ran')).toBe(false);
  });

  test('command: in the log with exit 0', () => {
    expect(holds('command', 'bun test')).toBe(true);
    expect(holds('command', '  bun   test ')).toBe(true);
    expect(holds('command', 'bun run check')).toBe(false);
    expect(holds('command', 'bun run lint')).toBe(false);
  });

  test('screenshot: an existing image under docs/screenshots/', () => {
    expect(holds('screenshot', 'docs/screenshots/empty.png')).toBe(true);
    expect(holds('screenshot', 'docs/screenshots/gone.png')).toBe(false);
    expect(holds('screenshot', 'docs/screenshots/../../src/a.ts')).toBe(false);
  });

  test('a verifier cannot claim the spec check, and an empty ref holds nothing', () => {
    expect(holds('check', 'spec:R-1')).toBe(false);
    expect(holds('file', ' ')).toBe(false);
  });
});

test('failedCitations names what does not hold', () => {
  const ev = [{kind: 'file' as const, ref: 'src/a.ts:1'}, {kind: 'command' as const, ref: 'bun run lint'}];
  expect(failedCitations(ev, e => evidenceHolds(record, e))).toEqual(['command bun run lint']);
});

test('testResults reads bun and TAP lines', () => {
  expect(testResults(record.commands)).toEqual([
    {name: 'the engine refuses a red merge', passed: true},
    {name: 'the engine names the head', passed: false},
    {name: 'tap style passes', passed: true},
    {name: 'tap style fails', passed: false},
  ]);
});

test('the command log round-trips and skips a torn line', () => {
  const run = {command: 'bun test', exit: 0, output: 'x'};
  expect(parseCommandLog(logLine(run) + '{"command":"b' + '\n' + logLine({...run, exit: 2}))).toEqual([run, {...run, exit: 2}]);
});
