import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {runGuardsCheck} from './guards-check';
import type {CommandRunner} from '../../ports';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

const SKIP = ['sk', 'ip'].join('');
const ONLY = ['on', 'ly'].join('');
const BASELINE = '.forger/coverage-baseline.json';

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-guards-'));
  dirs.push(root);
  const all = {'.forger/testing.json': JSON.stringify({coverage_baseline: BASELINE, test_paths: ['**/*.test.ts']}), ...files};
  for (const [name, body] of Object.entries(all)) {
    mkdirSync(join(root, name, '..'), {recursive: true});
    writeFileSync(join(root, name), body);
  }
  return root;
}

function git(opts: {diff?: string; untracked?: string; base?: Record<string, string>; patch?: string; branch?: string; body?: string}): CommandRunner {
  return cmd => {
    if (cmd.startsWith('git merge-base')) return 'abc123';
    if (cmd.startsWith('git rev-parse')) return opts.branch ?? 'feat/issue-9';
    if (cmd.startsWith('git diff --name-status')) return opts.diff ?? '';
    if (cmd.startsWith('git diff -U0')) return opts.patch ?? '';
    if (cmd.startsWith('git ls-files')) return opts.untracked ?? '';
    if (cmd.startsWith('gh issue view')) {
      if (opts.body === undefined) throw new Error('no gh');
      return opts.body;
    }
    const shown = /^git show \S+:(.+)$/.exec(cmd);
    return shown ? (opts.base?.[shown[1]] ?? '') : '';
  };
}

const lowered = {diff: `M\t${BASELINE}`, base: {[BASELINE]: '{"line_coverage": 90}'}};

describe('runGuardsCheck', () => {
  test('a lowered baseline fails and names the file and both values', () => {
    const out = runGuardsCheck(repo({[BASELINE]: '{"line_coverage": 80}'}), git(lowered));
    expect(out.map(f => f.file)).toEqual([BASELINE]);
    expect(out[0].detail).toContain('from 90 to 80');
  });

  test('a raised baseline passes', () => {
    expect(runGuardsCheck(repo({[BASELINE]: '{"line_coverage": 95}'}), git(lowered))).toEqual([]);
  });

  test('the ticket Decisions naming the guard file let it through', () => {
    const body = `## Decisions\n\n- owner: ${BASELINE} may drop\n`;
    expect(runGuardsCheck(repo({[BASELINE]: '{"line_coverage": 80}'}), git({...lowered, body}))).toEqual([]);
  });

  test('a branch that is not a ticket branch gets no decisions', () => {
    const body = `## Decisions\n\n- owner: ${BASELINE}\n`;
    expect(runGuardsCheck(repo({[BASELINE]: '{"line_coverage": 80}'}), git({...lowered, body, branch: 'main'}))).toHaveLength(1);
  });

  test('deleting a guard file or a test file fails, a moved test file does not', () => {
    const root = repo({});
    expect(runGuardsCheck(root, git({diff: `D\t${BASELINE}`})).map(f => f.rule)).toEqual(['guard-deleted']);
    expect(runGuardsCheck(root, git({diff: 'D\ta/x.test.ts'})).map(f => f.rule)).toEqual(['test-deleted']);
    expect(runGuardsCheck(repo({'b/x.test.ts': 'x'}), git({diff: 'D\ta/x.test.ts\nA\tb/x.test.ts'}))).toEqual([]);
  });

  test('a skip added to a changed test and a skip in a new test fail', () => {
    const root = repo({'a.test.ts': 'it("a")', 'n.test.ts': `a\ntest.${SKIP}("b")`});
    const patch = `@@ -1,0 +1,1 @@\n+it.${ONLY}("a")`;
    const out = runGuardsCheck(root, git({diff: 'M\ta.test.ts', untracked: 'n.test.ts', patch}));
    expect(out.map(f => [f.file, f.line])).toEqual([['a.test.ts', 1], ['n.test.ts', 2]]);
  });

  describe('the budgets baseline', () => {
    const BB = '.forger/budgets-baseline.json';
    const budgets = JSON.stringify({budgets: [{name: 'bundle', command: 'size', direction: 'down'}, {name: 'speed', command: 'fps', direction: 'up'}]});
    const base = {[BB]: '{"bundle": 100, "speed": 60}', '.forger/budgets.json': budgets};
    const at = (now: string) => runGuardsCheck(repo({[BB]: now, '.forger/budgets.json': budgets}), git({diff: `M\t${BB}`, base}));

    test('the budgets baseline is a guard file', () => {
      const out = at('{"bundle": 120, "speed": 60}');
      expect(out.map(f => f.file)).toEqual([BB]);
      expect(out[0].detail).toContain('from 100 to 120');
    });

    test('a number moving the good way, by its own direction, passes', () => {
      expect(at('{"bundle": 90, "speed": 70}')).toEqual([]);
    });

    test('direction up fails a smaller number and a removed budget fails', () => {
      expect(at('{"bundle": 100, "speed": 50}')).toHaveLength(1);
      expect(at('{"bundle": 100}')).toHaveLength(1);
    });
  });
});
