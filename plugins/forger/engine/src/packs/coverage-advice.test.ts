import {describe, expect, test} from 'bun:test';

import {coverageAdvice, formatCoverageAdvice} from './coverage-advice';
import type {RepoFacts} from './detect';

const facts = (f: Partial<RepoFacts>): RepoFacts => ({files: [], dirs: [], deps: [], tables: [], ...f});
const REPORT = 'coverage/lcov.info';

describe('coverageAdvice', () => {
  const cases: Array<[string, string, Partial<RepoFacts>, string | null, string | null]> = [
    ['bun from the gates', 'bun test', {}, 'bun', 'bun test --coverage --coverage-reporter=lcov'],
    ['bun from bunfig', 'make test', {files: ['bunfig.toml']}, 'bun', 'bun test --coverage --coverage-reporter=lcov'],
    ['vitest from deps', 'npm test', {deps: ['vitest']}, 'vitest', 'vitest run --coverage --coverage.reporter=lcov'],
    ['jest from deps', 'npm test', {deps: ['jest']}, 'jest', 'jest --coverage --coverageReporters=lcov'],
    ['pytest from the table', 'make', {tables: ['tool.pytest.ini_options']}, 'pytest', `pytest --cov --cov-report=lcov:${REPORT}`],
    ['gates win over files', 'pytest', {deps: ['jest']}, 'pytest', `pytest --cov --cov-report=lcov:${REPORT}`],
    ['unrecognised runner', 'make test', {}, null, null],
  ];
  for (const [name, gates, f, runner, command] of cases) {
    test(`${name}: names the runner and its flag`, () => {
      const a = coverageAdvice({gates, report: REPORT, reportExists: false, facts: facts(f)});
      expect([a.runner, a.command]).toEqual([runner, command]);
    });
  }

  test('a missing report with gates that do not write it names the report and the flag', () => {
    const a = coverageAdvice({gates: 'bun test', report: REPORT, reportExists: false, facts: facts({})});
    expect(a.gates_write_report).toBe(false);
    expect(a.next_steps.join('\n')).toContain(REPORT);
    expect(a.next_steps.join('\n')).toContain('--coverage-reporter=lcov');
    expect(a.next_steps.at(-1)).toContain('check coverage --update');
  });

  test('gates that already write lcov are not told to change', () => {
    const a = coverageAdvice({gates: 'bun test --coverage-reporter=lcov', report: REPORT, reportExists: false, facts: facts({})});
    expect(a.gates_write_report).toBe(true);
    expect(a.next_steps.join('\n')).not.toContain('make the gates write it');
  });

  test('an unrecognised runner is told to emit lcov at the report path', () => {
    const a = coverageAdvice({gates: 'make test', report: REPORT, reportExists: false, facts: facts({})});
    expect(a.next_steps.join('\n')).toContain(`emit an lcov report at ${REPORT}`);
  });

  test('an existing report only needs the first baseline', () => {
    const a = coverageAdvice({gates: 'bun test', report: REPORT, reportExists: true, facts: facts({})});
    expect(a.report_present).toBe(true);
    expect(a.next_steps).toEqual([`${REPORT} exists: set the first baseline with \`check coverage --update\``]);
  });

  test('formats one line per step', () => {
    const a = coverageAdvice({gates: 'x', report: REPORT, reportExists: true, facts: facts({})});
    expect(formatCoverageAdvice(a).startsWith('coverage ')).toBe(true);
  });
});
