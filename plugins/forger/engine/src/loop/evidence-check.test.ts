import {describe, expect, test} from 'bun:test';

import {evidenceHolds, failedCitations, testNameMatches, testResults, type CopyRecord} from './evidence-check';
import {loggedEnv, logLine, parseCommandLog} from './run-logged';

const output = ['(pass) the engine refuses a red merge [1.2ms]', '(pass) verify > classifyCriterion > a vague criterion fails [0.4ms]', '(fail) the engine names the head', 'ok 3 - tap style passes', 'not ok 4 - tap style fails'].join('\n');
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

  test('test: a "describe > test" reference holds for the nested test that passed', () => {
    expect(holds('test', 'verify > classifyCriterion > a vague criterion fails')).toBe(true);
    expect(holds('test', 'classifyCriterion > a vague criterion fails')).toBe(true);
    expect(holds('test', 'verify > a vague criterion fails')).toBe(true);
    expect(holds('test', 'classifyCriterion  >  a vague criterion fails')).toBe(true);
  });

  test('test: a "describe > test" reference not in the run does not hold', () => {
    expect(holds('test', 'otherDescribe > a vague criterion fails')).toBe(false);
    expect(holds('test', 'classifyCriterion > a criterion that never ran')).toBe(false);
    expect(holds('test', 'classifyCriterion > verify > a vague criterion fails')).toBe(false);
    expect(holds('test', 'classifyCriterion > the engine names the head')).toBe(false);
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
    {name: 'verify > classifyCriterion > a vague criterion fails', passed: true},
    {name: 'the engine names the head', passed: false},
    {name: 'tap style passes', passed: true},
    {name: 'tap style fails', passed: false},
  ]);
});

test('the command log round-trips and skips a torn line', () => {
  const run = {command: 'bun test', exit: 0, output: 'x'};
  expect(parseCommandLog(logLine(run) + '{"command":"b' + '\n' + logLine({...run, exit: 2}))).toEqual([run, {...run, exit: 2}]);
});

test('testNameMatches needs the last part to be the test itself', () => {
  expect(testNameMatches('a > b > c', 'a > c')).toBe(true);
  expect(testNameMatches('a > b > c', 'a > b')).toBe(true);
  expect(testNameMatches('a > b > cd', 'a > c')).toBe(false);
  expect(testNameMatches('a > b > c', 'a > x')).toBe(false);
});

test('a logged command runs without the switches that hide passed tests', () => {
  expect(loggedEnv({PATH: '/bin', CLAUDECODE: '1', REPL_ID: 'x', AGENT: '1', AI_AGENT: 'y', GONE: undefined})).toEqual({PATH: '/bin', AI_AGENT: 'y'});
});
