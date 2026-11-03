import {describe, expect, test} from 'bun:test';

import {
  TestingConfigError,
  basisPoints,
  checkCoverage,
  checkFixHasTest,
  checkNoNetwork,
  isFixSubject,
  isForbiddenModule,
  nextBaseline,
  parseBaseline,
  parseLcov,
  parseTestingConfig,
  renderBaseline,
  type TestingConfig,
} from './testing';

const config: TestingConfig = {
  test_paths: ['**/*.test.ts', 'tests/**'],
  integration_paths: ['**/integration/**'],
  network_modules: ['http', 'https', 'child_process', 'axios'],
  coverage_report: 'coverage/lcov.info',
  coverage_baseline: '.claude/coverage-baseline.json',
};

describe('parseTestingConfig', () => {
  test('accepts the full shape', () => {
    expect(parseTestingConfig(JSON.stringify(config))).toEqual(config);
  });

  const bad: Array<[string, string, string]> = [
    ['not json', '{', 'is not valid JSON'],
    ['an array', '[]', 'must be an object'],
    ['missing test_paths', JSON.stringify({...config, test_paths: undefined}), '"test_paths"'],
    ['an empty glob', JSON.stringify({...config, network_modules: ['']}), '"network_modules"'],
    ['a numeric report', JSON.stringify({...config, coverage_report: 3}), '"coverage_report"'],
    ['a blank baseline', JSON.stringify({...config, coverage_baseline: ' '}), '"coverage_baseline"'],
  ];
  for (const [name, text, message] of bad) {
    test(`rejects ${name}`, () => {
      expect(() => parseTestingConfig(text)).toThrow(TestingConfigError);
      expect(() => parseTestingConfig(text)).toThrow(message);
    });
  }
});

describe('isFixSubject', () => {
  const rows: Array<[string, boolean]> = [
    ['fix: stop the loop', true],
    ['fix(engine): stop the loop', true],
    ['fix!: break the format', true],
    ['  fix: padded', true],
    ['feat: add a thing', false],
    ['fixture: tidy', false],
    ['prefix: nothing', false],
    ['feat: fix: inside', false],
  ];
  for (const [subject, expected] of rows) {
    test(`${subject} -> ${expected}`, () => expect(isFixSubject(subject)).toBe(expected));
  }
});

describe('checkFixHasTest', () => {
  test('passes a branch with no fix commit', () => {
    expect(checkFixHasTest(['feat: a'], ['src/a.ts'], config)).toEqual([]);
  });
  test('passes a fix that changes a test', () => {
    expect(checkFixHasTest(['feat: a', 'fix: b'], ['src/a.ts', 'src/a.test.ts'], config)).toEqual([]);
  });
  test('passes a fix that adds a test under a test directory', () => {
    expect(checkFixHasTest(['fix(x): b'], ['tests/case.ts'], config)).toEqual([]);
  });
  test('fails a fix with no test and quotes the commit', () => {
    const [f] = checkFixHasTest(['fix: b'], ['src/a.ts'], config);
    expect(f).toMatchObject({file: '.', rule: 'fix-without-test', opinion: 'testing.fix-with-test'});
    expect(f.detail).toContain('fix: b');
  });
  test('fails a fix that changes nothing', () => {
    expect(checkFixHasTest(['fix: b'], [], config)).toHaveLength(1);
  });
});

describe('isForbiddenModule', () => {
  const rows: Array<[string, boolean]> = [
    ['http', true],
    ['node:http', true],
    ['child_process', true],
    ['node:child_process', true],
    ['axios/lib/core', true],
    ['http-proxy', false],
    ['./http', false],
    ['fs', false],
  ];
  for (const [spec, expected] of rows) {
    test(`${spec} -> ${expected}`, () => expect(isForbiddenModule(spec, config.network_modules)).toBe(expected));
  }
});

describe('checkNoNetwork', () => {
  const file = (path: string, content: string) => ({path, content});
  // Built from a variable so this file's own source never matches the rule it tests.
  const from = (m: string) => `import x from '${m}';`;
  const bare = (m: string) => `import '${m}';`;
  const req = (m: string) => `const x = require('${m}');`;
  const dyn = (m: string) => `const x = await import('${m}');`;

  test('flags each import form with its line', () => {
    const content = [from('http'), bare('node:https'), req('child_process'), dyn('axios')].join('\n');
    const found = checkNoNetwork([file('src/a.test.ts', content)], config);
    expect(found.map(f => [f.line, f.rule])).toEqual([
      [1, 'http'],
      [2, 'https'],
      [3, 'child_process'],
      [4, 'axios'],
    ]);
    expect(found.every(f => f.opinion === 'testing.no-network' && f.file === 'src/a.test.ts')).toBe(true);
  });

  test('reports a module once per line', () => {
    expect(checkNoNetwork([file('a.test.ts', `${from('http')} ${from('node:http')}`)], config)).toHaveLength(1);
  });

  test('ignores files that are not tests', () => {
    expect(checkNoNetwork([file('src/a.ts', bare('http'))], config)).toEqual([]);
  });

  test('exempts integration tests', () => {
    expect(checkNoNetwork([file('src/integration/a.test.ts', bare('http'))], config)).toEqual([]);
  });

  test('passes tests that import only local and safe modules', () => {
    expect(checkNoNetwork([file('a.test.ts', `${from('./http')}\n${from('fs')}`)], config)).toEqual([]);
  });
});

describe('coverage', () => {
  const lcov = 'SF:a.ts\nLF:10\nLH:9\nend_of_record\nSF:b.ts\nLF:10\nLH:5\nend_of_record\n';

  test('parseLcov sums line totals across files', () => {
    expect(parseLcov(lcov)).toEqual({found: 20, hit: 14});
  });
  test('parseLcov rejects a report with no lines', () => {
    expect(() => parseLcov('TN:\n')).toThrow('no instrumented lines');
  });

  const bp: Array<[number, number, number]> = [
    [14, 20, 7000],
    [2, 3, 6666],
    [1, 1, 10000],
    [0, 5, 0],
  ];
  for (const [hit, found, expected] of bp) {
    test(`basisPoints ${hit}/${found} rounds down to ${expected}`, () => expect(basisPoints({hit, found})).toBe(expected));
  }

  test('parseBaseline reads the percentage', () => {
    expect(parseBaseline('{"line_coverage": 87.31}', 'b.json')).toEqual({line_coverage: 87.31});
  });
  for (const text of ['{', '{}', '{"line_coverage":"9"}', '{"line_coverage":101}', '{"line_coverage":-1}']) {
    test(`parseBaseline rejects ${text}`, () => expect(() => parseBaseline(text, 'b.json')).toThrow('check coverage --update'));
  }

  test('renderBaseline writes the percentage with two decimals at most', () => {
    expect(JSON.parse(renderBaseline(8731))).toEqual({line_coverage: 87.31});
    expect(renderBaseline(8731).endsWith('\n')).toBe(true);
  });

  const rows: Array<[string, number, number | null, string[]]> = [
    ['equal passes', 8731, 87.31, []],
    ['higher passes', 9000, 87.31, []],
    ['lower fails', 8730, 87.31, ['coverage-dropped']],
    ['no baseline fails', 9000, null, ['no-baseline']],
  ];
  for (const [name, current, base, rules] of rows) {
    test(`checkCoverage ${name}`, () => {
      const found = checkCoverage(current, base === null ? null : {line_coverage: base}, 'b.json');
      expect(found.map(f => f.rule)).toEqual(rules);
      expect(found.every(f => f.opinion === 'testing.coverage-ratchet' && f.file === 'b.json')).toBe(true);
    });
  }

  test('a drop reports both numbers', () => {
    expect(checkCoverage(8000, {line_coverage: 87.31}, 'b.json')[0].detail).toContain('80.00%');
    expect(checkCoverage(8000, {line_coverage: 87.31}, 'b.json')[0].detail).toContain('87.31%');
  });

  const next: Array<[string, number, number | null, number | null]> = [
    ['creates when absent', 8000, null, 8000],
    ['raises when higher', 9000, 87.31, 9000],
    ['never lowers', 8000, 87.31, null],
    ['leaves an equal baseline', 8731, 87.31, null],
  ];
  for (const [name, current, base, expected] of next) {
    test(`nextBaseline ${name}`, () => expect(nextBaseline(current, base === null ? null : {line_coverage: base})).toBe(expected));
  }
});
