/**
 * What a freshly set-up repository needs for the testing pack's `check coverage`:
 * an lcov report the gates write. A pure function over facts a thin reader gathers.
 */

import type {RepoFacts} from './detect';

export interface CoverageInput {
  gates: string;
  /** The configured report path, relative to the root. */
  report: string;
  reportExists: boolean;
  facts: RepoFacts;
}

export interface CoverageAdvice {
  report: string;
  report_present: boolean;
  gates_write_report: boolean;
  runner: string | null;
  /** The test command with the flags that make it write the report, when the runner is recognised. */
  command: string | null;
  next_steps: string[];
}

const RUNNERS: Array<{id: string; gate: RegExp; facts: (f: RepoFacts) => boolean; command: (report: string) => string}> = [
  {
    id: 'bun',
    gate: /\bbun\s+test\b/,
    facts: f => f.deps.includes('@types/bun') || f.files.includes('bunfig.toml'),
    command: () => 'bun test --coverage --coverage-reporter=lcov',
  },
  {
    id: 'vitest',
    gate: /\bvitest\b/,
    facts: f => f.deps.includes('vitest'),
    command: () => 'vitest run --coverage --coverage.reporter=lcov',
  },
  {
    id: 'jest',
    gate: /\bjest\b/,
    facts: f => f.deps.includes('jest'),
    command: () => 'jest --coverage --coverageReporters=lcov',
  },
  {
    id: 'pytest',
    gate: /\bpytest\b/,
    facts: f => f.files.includes('pytest.ini') || f.tables.includes('tool.pytest.ini_options'),
    command: report => `pytest --cov --cov-report=lcov:${report}`,
  },
];

/** The runner the gates name, else the one the repository's own files point at. */
function recognise(gates: string, facts: RepoFacts) {
  return RUNNERS.find(r => r.gate.test(gates)) ?? RUNNERS.find(r => r.facts(facts)) ?? null;
}

export function coverageAdvice(input: CoverageInput): CoverageAdvice {
  const {gates, report, reportExists, facts} = input;
  const runner = recognise(gates, facts);
  const writes = gates.includes('lcov') || gates.includes(report);
  const command = runner ? runner.command(report) : null;
  const next_steps: string[] = [];
  if (!reportExists) {
    next_steps.push(`check coverage needs ${report}, which does not exist yet`);
    if (!writes) {
      next_steps.push(
        command
          ? `make the gates write it: run the tests as \`${command}\` (the report must end up at ${report})`
          : `make the gates write it: have the test command emit an lcov report at ${report}`
      );
    }
    next_steps.push(`run the gates once, then set the first baseline with \`check coverage --update\``);
  } else {
    next_steps.push(`${report} exists: set the first baseline with \`check coverage --update\``);
  }
  return {report, report_present: reportExists, gates_write_report: writes, runner: runner?.id ?? null, command, next_steps};
}

export function formatCoverageAdvice(advice: CoverageAdvice): string {
  return advice.next_steps.map(s => `coverage ${s}`).join('\n');
}
