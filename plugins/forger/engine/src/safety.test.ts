import {describe, expect, test} from 'bun:test';

import {SafetyConfigError, checkDataForward, checkSecrets, isEnvFile, parseAddedLines, parseSafetyConfig, scanLine} from './safety';

// Fake credentials are assembled at run time so this file never contains a real-looking secret.
const fake = {
  'private-key': ['-----BEGIN RSA ', 'PRIVATE KEY-----'].join(''),
  'aws-access-key-id': 'AKIA' + 'ABCDEFGHIJKLMNOP',
  'github-token': 'ghp_' + 'a'.repeat(36),
  'slack-token': 'xoxb-' + '1234567890-abcdefghij',
  'stripe-live-key': 'sk_live_' + 'a1B2c3D4e5F6g7H8i9J0k1L2',
  'google-api-key': 'AIza' + 'b'.repeat(35),
  'api-secret-key': 'sk-ant-' + 'x'.repeat(40),
};

describe('scanLine', () => {
  for (const [name, secret] of Object.entries(fake)) {
    test(`recognises a ${name}`, () => {
      expect(scanLine(`const k = "${secret}";`)).toEqual([name]);
    });
  }

  test.each([
    ['plain prose', 'the key is stored in the vault'],
    ['a short sk- prefix', 'sk-short'],
    ['an AKIA prefix that is too short', 'AKIA1234'],
    ['a git sha', 'a'.repeat(40)],
  ])('ignores %s', (_n, line) => {
    expect(scanLine(line)).toEqual([]);
  });
});

describe('parseAddedLines', () => {
  const diff = [
    'diff --git a/a.ts b/a.ts',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,0 +2,2 @@',
    '+one',
    '+two',
    '@@ -9 +11 @@',
    '-old',
    '+new',
    'diff --git a/gone.ts b/gone.ts',
    '--- a/gone.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-bye',
  ].join('\n');

  test('numbers added lines from each hunk header and skips removals and deleted files', () => {
    expect(parseAddedLines(diff)).toEqual([
      {file: 'a.ts', line: 2, text: 'one'},
      {file: 'a.ts', line: 3, text: 'two'},
      {file: 'a.ts', line: 11, text: 'new'},
    ]);
  });
});

describe('isEnvFile', () => {
  test.each([
    ['.env', true],
    ['app/.env.local', true],
    ['.env.production', true],
    ['.env.example', false],
    ['config/.env.sample', false],
    ['.env.template', false],
    ['environment.ts', false],
  ])('%s -> %p', (path, expected) => {
    expect(isEnvFile(path)).toBe(expected);
  });
});

describe('checkSecrets', () => {
  const secret = fake['github-token'];

  test('names file, line and pattern and never repeats the secret', () => {
    const out = checkSecrets([{file: 'a.ts', line: 4, text: `token = ${secret}`}], []);
    expect(out).toEqual([
      {file: 'a.ts', line: 4, rule: 'github-token', opinion: 'safety.secrets', detail: 'added line matches the github-token pattern (match not shown)'},
    ]);
    expect(JSON.stringify(out)).not.toContain(secret);
  });

  test('an env file is a finding on its own', () => {
    expect(checkSecrets([], ['.env']).map(f => [f.file, f.rule])).toEqual([['.env', 'env-file']]);
  });

  test('clean lines give no findings', () => {
    expect(checkSecrets([{file: 'a.ts', line: 1, text: 'const a = 1;'}], [])).toEqual([]);
  });
});

describe('parseSafetyConfig', () => {
  test('reads both lists', () => {
    expect(parseSafetyConfig('{"migration_paths":["db/**"],"data_test_paths":["t/**"]}')).toEqual({migration_paths: ['db/**'], data_test_paths: ['t/**']});
  });

  test.each([
    ['not json', '{'],
    ['an array', '[]'],
    ['a missing list', '{"migration_paths":["a"]}'],
    ['an empty glob', '{"migration_paths":[""],"data_test_paths":["a"]}'],
  ])('rejects %s', (_n, text) => {
    expect(() => parseSafetyConfig(text)).toThrow(SafetyConfigError);
  });
});

describe('checkDataForward', () => {
  const config = {migration_paths: ['db/migrations/**', '**/*.sql'], data_test_paths: ['tests/**']};

  test('a migration with no test fails on the migration file', () => {
    const out = checkDataForward(['db/migrations/001.ts', 'README.md'], config);
    expect(out.map(f => [f.file, f.rule, f.opinion])).toEqual([['db/migrations/001.ts', 'migration-without-test', 'safety.data-forward']]);
  });

  test('a migration with a test passes', () => {
    expect(checkDataForward(['db/migrations/001.ts', 'tests/carry.test.ts'], config)).toEqual([]);
  });

  test('a diff with no migration passes', () => {
    expect(checkDataForward(['src/a.ts'], config)).toEqual([]);
  });
});
