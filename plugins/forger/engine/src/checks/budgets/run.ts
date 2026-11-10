/**
 * The I/O half of `check budgets`: runs each budget's command through the
 * injected runner and reads or writes the recorded numbers.
 */

import {existsSync, readFileSync, writeFileSync} from 'fs';

import {forgerPath} from '../../config';
import type {CommandRunner} from '../../ports';
import type {Gap} from '../gaps';
import type {Finding} from '../waivers';
import {
  BUDGETS_BASELINE_PATH,
  BUDGETS_PATH,
  judgeBudget,
  measureOf,
  measureShellCommand,
  parseBudgetBaseline,
  parseBudgets,
  renderBudgetBaseline,
  updateBaseline,
  type Budget,
  type BudgetBaseline,
  type BudgetUpdate,
  type Measure,
} from './budgets';

export function loadBudgets(projectRoot: string): Budget[] {
  const file = forgerPath(projectRoot, BUDGETS_PATH);
  return existsSync(file) ? parseBudgets(readFileSync(file, 'utf-8')) : [];
}

function loadBaseline(projectRoot: string): BudgetBaseline {
  const file = forgerPath(projectRoot, BUDGETS_BASELINE_PATH);
  return existsSync(file) ? parseBudgetBaseline(readFileSync(file, 'utf-8')) : {};
}

function measure(budget: Budget, run: CommandRunner): Measure {
  try {
    return measureOf(run(measureShellCommand(budget.command)));
  } catch (e) {
    return {ok: false, reason: `the command could not be run: ${(e as Error).message}`};
  }
}

export function runBudgetsCheck(projectRoot: string, run: CommandRunner): {findings: Finding[]; gaps: Gap[]} {
  const budgets = loadBudgets(projectRoot);
  const baseline = loadBaseline(projectRoot);
  const verdicts = budgets.map(b => judgeBudget(b, measure(b, run), baseline[b.name]));
  return {findings: verdicts.flatMap(v => v.findings), gaps: verdicts.flatMap(v => v.gaps)};
}

/** Records new and better numbers; a worse or unmeasurable one is reported and left as it was. */
export function updateBudgetsBaseline(projectRoot: string, run: CommandRunner): BudgetUpdate {
  const budgets = loadBudgets(projectRoot);
  const update = updateBaseline(budgets, budgets.map(b => measure(b, run)), loadBaseline(projectRoot));
  if (update.moved.length > 0) writeFileSync(forgerPath(projectRoot, BUDGETS_BASELINE_PATH), renderBudgetBaseline(update.baseline));
  return update;
}
