/**
 * `check tests` and `check coverage`: a fix lands with the test that failed
 * before it, unit tests stay off the network and out of child processes, and
 * coverage never goes down. Every rule is pure over parsed inputs; the I/O
 * lives in testing-check.ts.
 */

import {globToRegExp, type Finding} from '../waivers';

export const TESTING_PATH = '.forger/testing.json';
export const FIX_OPINION = 'testing.fix-with-test';
export const NO_NETWORK_OPINION = 'testing.no-network';
export const COVERAGE_OPINION = 'testing.coverage-ratchet';

export interface TestingConfig {
  /** Globs of test files. */
  test_paths: string[];
  /** Globs of test files that may touch the network or spawn processes. */
  integration_paths: string[];
  /** Module names a unit test must not import. */
  network_modules: string[];
  /** The coverage report (lcov) the project's test command writes. */
  coverage_report: string;
  /** The generated file holding the coverage floor. */
  coverage_baseline: string;
}

export class TestingConfigError extends Error {
  constructor(problem: string) {
    super(`${TESTING_PATH}: ${problem}`);
  }
}

function strings(v: unknown, name: string): string[] {
  if (!Array.isArray(v) || v.some(s => typeof s !== 'string' || s.trim() === '')) {
    throw new TestingConfigError(`"${name}" must be a list of non-empty strings`);
  }
  return (v as string[]).map(s => s.trim());
}

function text(v: unknown, name: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw new TestingConfigError(`"${name}" must be a non-empty string`);
  return v.trim();
}

/** Parsed once at the boundary: a bad shape is an error, never a quiet pass. */
export function parseTestingConfig(raw: string): TestingConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TestingConfigError('is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new TestingConfigError('must be an object');
  const obj = parsed as Record<string, unknown>;
  return {
    test_paths: strings(obj.test_paths, 'test_paths'),
    integration_paths: strings(obj.integration_paths, 'integration_paths'),
    network_modules: strings(obj.network_modules, 'network_modules'),
    coverage_report: text(obj.coverage_report, 'coverage_report'),
    coverage_baseline: text(obj.coverage_baseline, 'coverage_baseline'),
  };
}

/** A conventional-commit subject of type `fix`, with or without a scope or `!`. */
export function isFixSubject(subject: string): boolean {
  return /^fix(?:\([^)]*\))?!?:/.test(subject.trim());
}

/** A branch with a `fix:` commit must add or change a test file. */
export function checkFixHasTest(subjects: string[], changedPaths: string[], config: TestingConfig): Finding[] {
  const fix = subjects.find(isFixSubject);
  if (fix === undefined) return [];
  const tests = config.test_paths.map(globToRegExp);
  if (changedPaths.some(p => tests.some(re => re.test(p)))) return [];
  return [
    {
      file: '.',
      line: 1,
      rule: 'fix-without-test',
      opinion: FIX_OPINION,
      detail: `the branch has a fix commit ("${fix.trim()}") but adds or changes no test under ${config.test_paths.join(', ')}`,
    },
  ];
}

const IMPORT_SPEC = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function moduleName(spec: string): string {
  return spec.replace(/^node:/, '');
}

/** Whether an import specifier names a forbidden module or one of its subpaths. */
export function isForbiddenModule(spec: string, forbidden: string[]): boolean {
  const name = moduleName(spec);
  return forbidden.some(m => name === m || name.startsWith(`${m}/`));
}

export interface TestFile {
  path: string;
  content: string;
}

export function checkNoNetwork(files: TestFile[], config: TestingConfig): Finding[] {
  const tests = config.test_paths.map(globToRegExp);
  const integration = config.integration_paths.map(globToRegExp);
  const findings: Finding[] = [];
  for (const f of files) {
    if (!tests.some(re => re.test(f.path)) || integration.some(re => re.test(f.path))) continue;
    f.content.split('\n').forEach((line, i) => {
      const seen = new Set<string>();
      for (const re of IMPORT_SPEC) {
        for (const m of line.matchAll(new RegExp(re.source, 'g'))) {
          const name = moduleName(m[1]);
          if (!seen.has(name) && isForbiddenModule(name, config.network_modules)) {
            seen.add(name);
            findings.push({
              file: f.path,
              line: i + 1,
              rule: name,
              opinion: NO_NETWORK_OPINION,
              detail: `a unit test imports ${name}; test adapters on recorded output, or move this test under ${config.integration_paths.join(', ')}`,
            });
          }
        }
      }
    });
  }
  return findings;
}

export interface Coverage {
  found: number;
  hit: number;
}

/** Line totals of an lcov report. A report with no instrumented lines is an error, not a pass. */
export function parseLcov(report: string): Coverage {
  let found = 0;
  let hit = 0;
  for (const line of report.split('\n')) {
    const m = /^(LF|LH):(\d+)\s*$/.exec(line);
    if (!m) continue;
    if (m[1] === 'LF') found += Number(m[2]);
    else hit += Number(m[2]);
  }
  if (found === 0) throw new Error('The coverage report has no instrumented lines');
  return {found, hit};
}

/** Line coverage in hundredths of a percent, rounded down so rounding never hides a drop. */
export function basisPoints(c: Coverage): number {
  return Math.floor((c.hit * 10000) / c.found);
}

export interface Baseline {
  line_coverage: number;
}

export function parseBaseline(raw: string, path: string): Baseline {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${path} is not valid JSON; regenerate it with check coverage --update`);
  }
  const v = (parsed as {line_coverage?: unknown} | null)?.line_coverage;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) {
    throw new Error(`${path} must hold a "line_coverage" percentage; regenerate it with check coverage --update`);
  }
  return {line_coverage: v};
}

export function renderBaseline(bp: number): string {
  return `${JSON.stringify({line_coverage: bp / 100}, null, 2)}\n`;
}

function percent(bp: number): string {
  return (bp / 100).toFixed(2);
}

export function checkCoverage(current: number, baseline: Baseline | null, baselinePath: string): Finding[] {
  if (baseline === null) {
    return [{file: baselinePath, line: 1, rule: 'no-baseline', opinion: COVERAGE_OPINION, detail: 'no coverage baseline; run check coverage --update to create it'}];
  }
  const floor = Math.round(baseline.line_coverage * 100);
  if (current >= floor) return [];
  return [
    {
      file: baselinePath,
      line: 1,
      rule: 'coverage-dropped',
      opinion: COVERAGE_OPINION,
      detail: `line coverage is ${percent(current)}%, below the baseline ${percent(floor)}%; add tests rather than lower the baseline`,
    },
  ];
}

/** The baseline to write on --update: created if absent, raised if coverage rose, never lowered. */
export function nextBaseline(current: number, baseline: Baseline | null): number | null {
  if (baseline === null) return current;
  return current > Math.round(baseline.line_coverage * 100) ? current : null;
}
