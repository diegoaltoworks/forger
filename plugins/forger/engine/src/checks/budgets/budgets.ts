/**
 * The pure half of `check budgets`: the config, the baseline, and the verdicts
 * that compare a measured number with the recorded one. A number may only move
 * the good way; the I/O lives in run.ts.
 */

import type {Gap} from '../gaps';
import type {Finding} from '../waivers';

export const BUDGETS_PATH = '.forger/budgets.json';
export const BUDGETS_BASELINE_PATH = '.forger/budgets-baseline.json';
export const BUDGET_OPINION = 'testing.budget-ratchet';

/** `down`: smaller is better. `up`: larger is better. */
export type BudgetDirection = 'down' | 'up';

export interface Budget {
  name: string;
  /** Prints one number on its last line. */
  command: string;
  direction: BudgetDirection;
}

export type BudgetBaseline = Record<string, number>;

export class BudgetsConfigError extends Error {
  constructor(path: string, problem: string) {
    super(`${path}: ${problem}`);
  }
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

function objectOf(raw: string, path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BudgetsConfigError(path, 'is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new BudgetsConfigError(path, 'must be an object');
  return parsed as Record<string, unknown>;
}

function parseBudget(raw: unknown, index: number): Budget {
  const at = `budgets[${index}]`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new BudgetsConfigError(BUDGETS_PATH, `${at} must be an object`);
  const obj = raw as Record<string, unknown>;
  if (!isText(obj.name)) throw new BudgetsConfigError(BUDGETS_PATH, `${at} needs a "name"`);
  const label = `${at} ("${obj.name.trim()}")`;
  if (!isText(obj.command)) throw new BudgetsConfigError(BUDGETS_PATH, `${label} needs a "command"`);
  if (obj.direction !== 'down' && obj.direction !== 'up') {
    throw new BudgetsConfigError(BUDGETS_PATH, `${label} needs a "direction" of "down" (smaller is better) or "up"`);
  }
  return {name: obj.name.trim(), command: obj.command.trim(), direction: obj.direction};
}

export function parseBudgets(raw: string): Budget[] {
  const obj = objectOf(raw, BUDGETS_PATH);
  if (!Array.isArray(obj.budgets)) throw new BudgetsConfigError(BUDGETS_PATH, '"budgets" must be a list');
  const budgets = obj.budgets.map(parseBudget);
  const dup = budgets.find((b, i) => budgets.findIndex(o => o.name === b.name) !== i);
  if (dup) throw new BudgetsConfigError(BUDGETS_PATH, `two budgets are named "${dup.name}"`);
  return budgets;
}

export function parseBudgetBaseline(raw: string): BudgetBaseline {
  const obj = objectOf(raw, BUDGETS_BASELINE_PATH);
  const out: BudgetBaseline = {};
  for (const [name, value] of Object.entries(obj)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new BudgetsConfigError(BUDGETS_BASELINE_PATH, `"${name}" must be a number`);
    out[name] = value;
  }
  return out;
}

export function renderBudgetBaseline(baseline: BudgetBaseline): string {
  const sorted = Object.fromEntries(Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/** The direction of each budget by name, for the guard that reads the baseline. */
export function directionsOf(budgets: Budget[]): Record<string, BudgetDirection> {
  return Object.fromEntries(budgets.map(b => [b.name, b.direction]));
}

const EXIT_MARK = 'forger-budget-exit:';
const TAIL_LINES = 5;

/** The command run through a shell that reports its exit status in the output. */
export function measureShellCommand(command: string): string {
  return `(
${command}
) 2>&1; printf '\\n${EXIT_MARK}%s\\n' "$?"`;
}

export type Measure = {ok: true; value: number} | {ok: false; reason: string};

/** The number on the last line of a command's output, or why there is none. */
export function measureOf(output: string): Measure {
  const at = output.lastIndexOf(EXIT_MARK);
  const body = (at < 0 ? output : output.slice(0, at)).trim();
  const tail = body.split('\n').slice(-TAIL_LINES).join('\n');
  const code = at < 0 ? null : Number(output.slice(at + EXIT_MARK.length).trim());
  if (code !== 0) return {ok: false, reason: `the command ${code === null || Number.isNaN(code) ? 'did not report a status' : `exited ${code}`}${tail ? `\n${tail}` : ''}`};
  const last = body.split('\n').pop()?.trim() ?? '';
  const value = last === '' ? NaN : Number(last);
  if (!Number.isFinite(value)) return {ok: false, reason: `the last line of its output is not a number: "${last}"`};
  return {ok: true, value};
}

/** True when `value` is worse than `baseline` for the direction; equal is not worse. */
export function isWorse(direction: BudgetDirection, value: number, baseline: number): boolean {
  return direction === 'down' ? value > baseline : value < baseline;
}

const finding = (rule: string, detail: string): Finding => ({file: BUDGETS_BASELINE_PATH, line: 1, rule, opinion: BUDGET_OPINION, detail});

export interface BudgetVerdict {
  findings: Finding[];
  gaps: Gap[];
}

/** One budget against its measurement and recorded number. */
export function judgeBudget(budget: Budget, measure: Measure, baseline: number | undefined): BudgetVerdict {
  if (!measure.ok) return {findings: [finding('budget-unmeasurable', `budget "${budget.name}" could not be measured: ${measure.reason}`)], gaps: []};
  if (baseline === undefined) {
    return {
      findings: [],
      gaps: [
        {
          file: BUDGETS_BASELINE_PATH,
          opinion: BUDGET_OPINION,
          modality: 'SHOULD',
          detail: `budget "${budget.name}" has no recorded number (it measures ${measure.value}); run "check budgets --update"`,
        },
      ],
    };
  }
  if (isWorse(budget.direction, measure.value, baseline)) {
    const way = budget.direction === 'down' ? 'above' : 'below';
    return {findings: [finding('budget-worse', `budget "${budget.name}" is ${measure.value}, ${way} its recorded ${baseline} (${budget.direction} is better)`)], gaps: []};
  }
  return {findings: [], gaps: []};
}

export interface BudgetUpdate {
  baseline: BudgetBaseline;
  /** Names whose number was written or moved the good way. */
  moved: string[];
  /** One sentence per budget not written: worse than recorded, or not measurable. */
  refused: string[];
}

/** The baseline after an update: a number is recorded when new or better, never when worse. */
export function updateBaseline(budgets: Budget[], measures: Measure[], baseline: BudgetBaseline): BudgetUpdate {
  const next: BudgetBaseline = {...baseline};
  const moved: string[] = [];
  const refused: string[] = [];
  budgets.forEach((b, i) => {
    const m = measures[i];
    if (!m.ok) {
      refused.push(`budget "${b.name}" not updated: ${m.reason}`);
      return;
    }
    const old = baseline[b.name];
    if (old !== undefined && isWorse(b.direction, m.value, old)) {
      refused.push(`budget "${b.name}" not updated: ${m.value} is worse than the recorded ${old} (${b.direction} is better)`);
      return;
    }
    if (old === m.value) return;
    next[b.name] = m.value;
    moved.push(b.name);
  });
  return {baseline: next, moved, refused};
}
