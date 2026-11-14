import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {mergeConfig} from '../config';
import {checkGuards, defaultGuards, guardsReport, guardsSection} from './guards';
import {guardGlobsOf} from './ticket-check';

describe('guardsSection', () => {
  test.each([
    ['## Guards\n\ncoverage 80 in .forger/coverage-baseline.json\n\n## Other\nx', 'coverage 80 in .forger/coverage-baseline.json'],
    ['## Guards\n<!-- hint -->\n', ''],
    ['## Guards', ''],
  ])('reads %j', (body, text) => {
    expect(guardsSection(body)).toEqual({present: true, text});
  });
  test('absent without the heading', () => {
    expect(guardsSection('## Knock-on\nGuards are nice')).toEqual({present: false});
  });
});

describe('checkGuards', () => {
  test('missing warns, empty refuses, filled passes', () => {
    expect(checkGuards('x').warnings).toHaveLength(1);
    expect(checkGuards('x').problems).toEqual([]);
    expect(checkGuards('## Guards\n').problems).toHaveLength(1);
    expect(checkGuards('## Guards\nnone\n')).toEqual({warnings: [], problems: []});
  });
});

describe('guardsReport', () => {
  test('facts --guards lists the configured guard files and the tests that name a given path', () => {
    const files = ['a/budget.json', 'a/layout.e2e.spec.ts', 'a/other.test.ts', 'src/x.ts'];
    const text: Record<string, string> = {'a/layout.e2e.spec.ts': "expect(file).toBe('src/x.ts')", 'a/other.test.ts': 'nothing'};
    const r = guardsReport(['src/x.ts'], files, ['a/*.json'], ['**/*.test.*', '**/*.spec.*'], f => text[f]);
    expect(r).toEqual({paths: ['src/x.ts'], guards: ['a/budget.json'], tests: ['a/layout.e2e.spec.ts'], journeys: []});
  });

  test('facts --guards lists a journey whose paths match a touched file', () => {
    const journeys = [
      {name: 'sign up', command: 'x', paths: ['src/auth/**']},
      {name: 'checkout', command: 'y', paths: ['src/cart/**']},
    ];
    const r = guardsReport(['src/auth/login.ts'], [], [], [], () => '', journeys);
    expect(r.journeys).toEqual(['sign up']);
  });
});

describe('default guards', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
  });
  function root(files: Record<string, string>): string {
    const r = mkdtempSync(join(tmpdir(), 'forger-guards-'));
    dirs.push(r);
    mkdirSync(join(r, '.forger'));
    for (const [f, c] of Object.entries(files)) writeFileSync(join(r, f), c);
    return r;
  }
  test('the default guards hold the coverage baseline when the testing pack is installed', () => {
    const r = root({'.forger/testing.json': JSON.stringify({coverage_baseline: '.forger/coverage-baseline.json'})});
    expect(guardGlobsOf(r, mergeConfig({}))).toEqual(['.forger/coverage-baseline.json']);
  });
  test('the ui manifest joins when the ui pack is installed, and nothing when neither is', () => {
    const r = root({'.forger/ui.json': '{}'});
    expect(guardGlobsOf(r, mergeConfig({}))).toEqual(['.forger/ui-baselines/approved.json']);
    expect(guardGlobsOf(root({}), mergeConfig({}))).toEqual([]);
    expect(defaultGuards({coverageBaseline: null, uiInstalled: false, structureInstalled: false})).toEqual([]);
  });
  test('a configured list replaces the defaults', () => {
    expect(guardGlobsOf(root({'.forger/ui.json': '{}'}), mergeConfig({guards: ['perf/*.json']}))).toEqual(['perf/*.json']);
  });
});
