import {afterEach, describe, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {CommandRunner} from '../../ports';
import {BudgetsConfigError, parseBudgetBaseline, parseBudgets} from './budgets';
import {runBudgetsCheck, updateBudgetsBaseline} from './run';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

const b = (name: string, command: string, direction = 'down') => ({name, command, direction});

function repo(budgets: object[] | null, baseline: object | null = null): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-budgets-'));
  dirs.push(root);
  mkdirSync(join(root, '.forger'));
  if (budgets !== null) writeFileSync(join(root, '.forger/budgets.json'), JSON.stringify({budgets}));
  if (baseline !== null) writeFileSync(join(root, '.forger/budgets-baseline.json'), JSON.stringify(baseline));
  return root;
}

/** Canned shell: the output and exit status by the budget command a call wraps. */
function shell(results: Record<string, {out: string; code?: number}>): CommandRunner {
  return cmd => {
    const hit = Object.keys(results).find(c => cmd.includes(c));
    if (hit === undefined) throw new Error('unexpected command');
    return `${results[hit].out}\nforger-budget-exit:${results[hit].code ?? 0}\n`;
  };
}

describe('runBudgetsCheck', () => {
  test('a number worse than the baseline is a finding with both numbers', () => {
    const {findings} = runBudgetsCheck(repo([b('bundle', 'size')], {bundle: 100}), shell({size: {out: 'building\n120'}}));
    expect(findings).toHaveLength(1);
    expect(findings[0].opinion).toBe('testing.budget-ratchet');
    expect(findings[0].detail).toContain('120');
    expect(findings[0].detail).toContain('100');
  });

  test('a number that does not cross the baseline is no finding', () => {
    const root = repo([b('bundle', 'size'), b('type-errors', 'errs')], {bundle: 100, 'type-errors': 4});
    const out = runBudgetsCheck(root, shell({size: {out: '100'}, errs: {out: '3'}}));
    expect(out).toEqual({findings: [], gaps: []});
  });

  test('direction up treats a smaller number as worse', () => {
    const root = repo([b('speed', 'fps', 'up')], {speed: 60});
    expect(runBudgetsCheck(root, shell({fps: {out: '59'}})).findings).toHaveLength(1);
    expect(runBudgetsCheck(root, shell({fps: {out: '61'}})).findings).toEqual([]);
  });

  test('output that is not a number is a finding', () => {
    const {findings} = runBudgetsCheck(repo([b('bundle', 'size')], {bundle: 100}), shell({size: {out: 'done'}}));
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('not a number');
  });

  test('a command that fails is a finding', () => {
    const {findings} = runBudgetsCheck(repo([b('bundle', 'size')], {bundle: 100}), shell({size: {out: 'boom', code: 2}}));
    expect(findings[0].detail).toContain('exited 2');
  });

  test('a command that cannot be run is a finding', () => {
    const run: CommandRunner = () => {
      throw new Error('no shell');
    };
    expect(runBudgetsCheck(repo([b('bundle', 'size')], {bundle: 1}), run).findings[0].detail).toContain('no shell');
  });

  test('a budget with no baseline entry is a gap', () => {
    const {findings, gaps} = runBudgetsCheck(repo([b('bundle', 'size')]), shell({size: {out: '5'}}));
    expect(findings).toEqual([]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].detail).toContain('--update');
  });

  test('no budgets file or an empty list is nothing to report', () => {
    expect(runBudgetsCheck(repo(null), shell({}))).toEqual({findings: [], gaps: []});
    expect(runBudgetsCheck(repo([]), shell({}))).toEqual({findings: [], gaps: []});
  });
});

describe('updateBudgetsBaseline', () => {
  const written = (root: string) => JSON.parse(readFileSync(join(root, '.forger/budgets-baseline.json'), 'utf-8'));

  test('update never writes a worse number', () => {
    const root = repo([b('bundle', 'size')], {bundle: 100});
    const update = updateBudgetsBaseline(root, shell({size: {out: '120'}}));
    expect(update.refused).toHaveLength(1);
    expect(update.refused[0]).toContain('120');
    expect(written(root)).toEqual({bundle: 100});
  });

  test('update records a new budget and a better number', () => {
    const root = repo([b('bundle', 'size'), b('speed', 'fps', 'up'), b('fresh', 'new')], {bundle: 100, speed: 60});
    const update = updateBudgetsBaseline(root, shell({size: {out: '90'}, fps: {out: '70'}, new: {out: '7'}}));
    expect(update.moved.sort()).toEqual(['bundle', 'fresh', 'speed']);
    expect(written(root)).toEqual({bundle: 90, fresh: 7, speed: 70});
  });

  test('update leaves an equal number and an unmeasurable budget alone', () => {
    const root = repo([b('bundle', 'size'), b('bad', 'junk')], {bundle: 100});
    const update = updateBudgetsBaseline(root, shell({size: {out: '100'}, junk: {out: 'x'}}));
    expect(update.moved).toEqual([]);
    expect(update.refused).toHaveLength(1);
  });
});

describe('parsing', () => {
  test('a budget without a direction names itself in the error', () => {
    expect(() => parseBudgets(JSON.stringify({budgets: [{name: 'x', command: 'c'}]}))).toThrow(BudgetsConfigError);
    expect(() => parseBudgets(JSON.stringify({budgets: [{name: 'x', command: 'c'}]}))).toThrow('"x"');
  });

  test('two budgets with one name, and a non-number baseline, are errors', () => {
    expect(() => parseBudgets(JSON.stringify({budgets: [b('x', 'c'), b('x', 'd')]}))).toThrow('two budgets');
    expect(() => parseBudgetBaseline('{"x": "1"}')).toThrow('must be a number');
    expect(() => parseBudgets('nope')).toThrow('not valid JSON');
    expect(() => parseBudgets('{}')).toThrow('"budgets"');
  });
});
