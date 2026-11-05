import {afterEach, describe, expect, spyOn, test} from 'bun:test';
import {mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {AgentRunner} from '../ports';
import {loadCases} from './eval';
import {main} from './main';

const dirs: string[] = [];
const cwd = process.cwd();
const pluginRoot = join(import.meta.dir, '..', '..', '..');
afterEach(() => {
  process.chdir(cwd);
  process.exitCode = 0;
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function project(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-eval-test-')));
  dirs.push(root);
  mkdirSync(join(root, '.forger'));
  writeFileSync(join(root, '.forger', 'backlog.json'), JSON.stringify({features: {}}));
  writeFileSync(join(root, '.forger', 'workloop.config.json'), JSON.stringify({tracker: {kind: 'local'}}));
  return root;
}

/** A harness stand-in: finds where the prompt says to write, and writes what `answer` gives for the case. */
function fakeAgent(answer: (input: string) => unknown, prompts: string[] = []): AgentRunner {
  return {
    async run(opts) {
      prompts.push(opts.prompt);
      const path = /write your result to (\S+) as/.exec(opts.prompt)?.[1];
      const result = answer(opts.prompt);
      if (path && result !== undefined) writeFileSync(path, JSON.stringify(result));
      return {exitCode: 0, signal: null, output: '', timedOut: false};
    },
  };
}

async function evalRun(argv: string[], agent: AgentRunner): Promise<{out: {slot: string; skill: string; passed: number; total: number; cases: Array<{case: string; passed: boolean}>}; code: number}> {
  const lines: string[] = [];
  const spy = spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
  try {
    await main(['eval', ...argv, '--json'], {agent});
  } finally {
    spy.mockRestore();
  }
  const code = Number(process.exitCode ?? 0);
  process.exitCode = 0;
  return {out: JSON.parse(lines.join('\n')), code};
}

describe('shipped cases', () => {
  for (const slot of ['review', 'test_first', 'diagnose']) {
    test(`${slot} has well-formed cases`, () => {
      const cases = loadCases(pluginRoot, slot);
      expect(cases.length).toBeGreaterThan(0);
      for (const c of cases) {
        expect(c.input.trim()).not.toBe('');
        expect(c.properties.length).toBeGreaterThan(0);
      }
    });
  }
});

describe('eval --slot review', () => {
  test('runs every case through the agent and scores each result', async () => {
    const root = project();
    process.chdir(root);
    const prompts: string[] = [];
    const agent = fakeAgent(input => (input.includes('lastN') ? [{severity: 'high', file: 'src/list.ts', line: 6, summary: 'slice is off by one', disposition: 'fixed'}] : []), prompts);
    const {out, code} = await evalRun(['--slot', 'review', '--skill', 'builtin'], agent);
    expect(out.skill).toBe('builtin');
    expect(out.cases.map(c => [c.case, c.passed])).toEqual([['clean-rename', true], ['off-by-one', true]]);
    expect(code).toBe(0);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('skills/review/SKILL.md');
    const report = readdirSync(join(root, '.forger', 'output')).filter(f => f.startsWith('eval-review-builtin'));
    expect(report).toHaveLength(1);
  });

  test('a missed defect and a contract failure fail the run with exit 1', async () => {
    process.chdir(project());
    const {out, code} = await evalRun(['--slot', 'review', '--skill', 'some:community-review'], fakeAgent(input => (input.includes('lastN') ? [] : undefined)));
    expect(out.passed).toBe(0);
    expect(out.cases.every(c => !c.passed)).toBe(true);
    expect(code).toBe(1);
  });

  test('a skill file is followed by path', async () => {
    const root = project();
    process.chdir(root);
    const file = join(root, 'mine.md');
    writeFileSync(file, '# mine');
    const prompts: string[] = [];
    await evalRun(['--slot', 'review', '--skill', file], fakeAgent(() => [], prompts));
    expect(prompts[0]).toContain(`Read the file ${file}`);
  });

  test('refuses a slot with no cases and a missing skill file', async () => {
    process.chdir(project());
    const err = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await main(['eval', '--slot', 'merge_conflicts', '--skill', 'builtin']);
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
      await main(['eval', '--slot', 'review', '--skill', 'nope/missing.md']);
      expect(process.exitCode).toBe(1);
    } finally {
      err.mockRestore();
    }
  });
});
