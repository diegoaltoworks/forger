import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {CommandRunner} from '../../ports';
import {runSafetyCheck, runSafetyCheckOutput} from './safety-check';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

const CONFIG = JSON.stringify({migration_paths: ['db/migrations/**'], data_test_paths: ['tests/**']});

function repo(files: Record<string, string>, config: string | null = CONFIG): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-safety-'));
  dirs.push(root);
  const all = config === null ? files : {'.forger/safety.json': config, ...files};
  for (const [name, body] of Object.entries(all)) {
    mkdirSync(join(root, name, '..'), {recursive: true});
    writeFileSync(join(root, name), body);
  }
  return root;
}

/** Canned git: merge-base, name-status, the -U0 diff and untracked files. */
function git(opts: {status?: string; diff?: string; untracked?: string; mergeBase?: string}): CommandRunner {
  return cmd => {
    if (cmd.startsWith('git merge-base')) return opts.mergeBase ?? 'abc123';
    if (cmd.startsWith('git diff --name-status')) return opts.status ?? '';
    if (cmd.startsWith('git diff -U0')) return opts.diff ?? '';
    if (cmd.startsWith('git ls-files')) return opts.untracked ?? '';
    return '';
  };
}

const token = 'ghp_' + 'z'.repeat(36);
const addedLine = (file: string, text: string) => `+++ b/${file}\n@@ -0,0 +3 @@\n+${text}`;

describe('runSafetyCheck', () => {
  test('a secret added to a tracked file fails on its line', () => {
    const root = repo({'a.ts': ''});
    const out = runSafetyCheck(root, git({status: 'M\ta.ts', diff: addedLine('a.ts', `t = "${token}"`)}));
    expect(out.map(f => [f.file, f.line, f.rule])).toEqual([['a.ts', 3, 'github-token']]);
  });

  test('a secret in an untracked file fails too', () => {
    const root = repo({'new.ts': `ok\nt = "${token}"\n`});
    const out = runSafetyCheck(root, git({untracked: 'new.ts'}));
    expect(out.map(f => [f.file, f.line, f.rule])).toEqual([['new.ts', 2, 'github-token']]);
  });

  test('an untracked env file fails; its example passes', () => {
    const root = repo({'.env': 'A=1\n', '.env.example': 'A=\n'});
    const out = runSafetyCheck(root, git({untracked: '.env\n.env.example'}));
    expect(out.map(f => [f.file, f.rule])).toEqual([['.env', 'env-file']]);
  });

  test('a migration without a test fails; with a test passes', () => {
    const root = repo({'db/migrations/1.ts': 'x', 'tests/m.test.ts': 'y'});
    expect(runSafetyCheck(root, git({status: 'A\tdb/migrations/1.ts'})).map(f => f.rule)).toEqual(['migration-without-test']);
    expect(runSafetyCheck(root, git({status: 'A\tdb/migrations/1.ts\nA\ttests/m.test.ts'}))).toEqual([]);
  });

  test('a deleted migration needs no test', () => {
    const root = repo({});
    expect(runSafetyCheck(root, git({status: 'D\tdb/migrations/1.ts'}))).toEqual([]);
  });

  test('a clean branch passes', () => {
    const root = repo({'a.ts': 'x'});
    expect(runSafetyCheck(root, git({status: 'M\ta.ts', diff: addedLine('a.ts', 'const a = 1;')}))).toEqual([]);
  });

  test('a missing config is an error, not a pass', () => {
    expect(() => runSafetyCheck(repo({}, null), git({}))).toThrow('.forger/safety.json not found');
  });

  test('an unresolvable base is an error, not a pass', () => {
    expect(() => runSafetyCheck(repo({}), git({mergeBase: ''}))).toThrow('merge-base');
  });
});

describe('the dependency audit', () => {
  const withAudit = JSON.stringify({migration_paths: [], data_test_paths: [], audit_command: 'npm audit --audit-level=high'});
  const auditRun = (reply: string, seen: string[] = []): CommandRunner => cmd => {
    if (cmd.includes('npm audit')) {
      seen.push(cmd);
      return reply;
    }
    return git({})(cmd);
  };

  test('an audit command that exits non-zero is a finding with the end of its output', () => {
    const root = repo({}, withAudit);
    const lines = Array.from({length: 40}, (_, i) => `line ${i}`).join('\n');
    const out = runSafetyCheck(root, auditRun(`${lines}\n\nforger-audit-exit:1\n`));
    expect(out).toHaveLength(1);
    expect(out[0].opinion).toBe('safety.dependency-audit');
    expect(out[0].detail).toContain('line 39');
    expect(out[0].detail).not.toContain('line 0\n');
  });

  test('an audit command that exits zero is no finding', () => {
    const root = repo({}, withAudit);
    expect(runSafetyCheck(root, auditRun('found 0 vulnerabilities\n\nforger-audit-exit:0\n'))).toEqual([]);
  });

  test('an audit command that cannot start is a finding', () => {
    const root = repo({}, withAudit);
    expect(runSafetyCheck(root, auditRun('sh: npm: not found\n\nforger-audit-exit:127\n')).map(f => f.rule)).toEqual(['audit-cannot-start']);
    expect(runSafetyCheck(root, auditRun('')).map(f => f.rule)).toEqual(['audit-cannot-start']);
  });

  test('no audit command configured is a gap, not a pass', () => {
    const root = repo({});
    const out = runSafetyCheckOutput(root, git({}));
    expect(out.findings).toEqual([]);
    expect(out.gaps).toEqual([{file: '.forger/safety.json', opinion: 'safety.dependency-audit', modality: 'MAY', detail: 'no audit command configured'}]);
  });

  test('a configured audit command leaves no gap', () => {
    const root = repo({}, withAudit);
    expect(runSafetyCheckOutput(root, auditRun('\nforger-audit-exit:0\n')).gaps).toEqual([]);
  });
});
