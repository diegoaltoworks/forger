/**
 * `check guards`: a diff may not loosen a guarantee. Loosening a guard file
 * (a minimum lowered, a maximum raised, a number of unknown direction changed),
 * deleting a guard or test file, or skipping a test fails, unless the ticket's
 * Decisions section names the file. Every rule is pure over parsed text; the
 * I/O lives in guards-check.ts.
 */

import {isWorse, type BudgetDirection} from '../budgets/budgets';
import {globToRegExp, type Finding} from '../waivers';

export const GUARDS_OPINION = 'base.guards-hold';

const PROCEED = 'ask the owner; the owner records the answer with "decide <n>", and the ticket\'s Decisions section then names this file';

export type Direction = 'minimum' | 'maximum' | 'unknown';

const MINIMUM = new Set(['min', 'minimum', 'floor', 'coverage', 'least', 'lower', 'baseline']);
const MAXIMUM = new Set(['max', 'maximum', 'limit', 'budget', 'ceiling', 'cap', 'upper', 'most']);

/** What a number's name says it is, read from its words (`maxBytes`, `line_coverage`); unknown when it says nothing. */
export function directionOf(key: string): Direction {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w !== '');
  const min = words.some(w => MINIMUM.has(w));
  const max = words.some(w => MAXIMUM.has(w));
  if (min === max) return 'unknown';
  return min ? 'minimum' : 'maximum';
}

const NUMBER = /["']?([A-Za-z_][\w.-]*)["']?\s*[:=]\s*(-?\d+(?:\.\d+)?)(?![\w.])/g;

/** The `key: number` pairs of a text, each key suffixed with its occurrence so repeats stay apart. */
export function numbersOf(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const m of text.matchAll(NUMBER)) {
    const n = (seen.get(m[1]) ?? 0) + 1;
    seen.set(m[1], n);
    out.set(n === 1 ? m[1] : `${m[1]}#${n}`, Number(m[2]));
  }
  return out;
}

function keyName(key: string): string {
  return key.replace(/#\d+$/, '');
}

/** Numbers that went the loosening way between two versions of a guard file; a removed number loosens. */
export function loosened(file: string, before: string, after: string): Finding[] {
  const was = numbersOf(before);
  const now = numbersOf(after);
  const findings: Finding[] = [];
  for (const [key, old] of was) {
    const value = now.get(key);
    const name = keyName(key);
    const dir = directionOf(name);
    if (value === old) continue;
    if (value !== undefined && ((dir === 'minimum' && value > old) || (dir === 'maximum' && value < old))) continue;
    const to = value === undefined ? 'removed' : String(value);
    const why = dir === 'unknown' ? 'its direction is unknown, so a change counts as loosening' : dir === 'minimum' ? 'a minimum went down' : 'a maximum went up';
    findings.push({
      file,
      line: 1,
      rule: 'guard-loosened',
      opinion: GUARDS_OPINION,
      detail: `${name} changed from ${old} to ${to} (${why}); ${PROCEED}`,
    });
  }
  return findings;
}

/**
 * Numbers of the budgets baseline that went the loosening way: the direction
 * comes from the budget's own entry, not from the name. A budget with no known
 * direction, or a removed number, counts as loosened.
 */
export function loosenedBudgets(file: string, before: string, after: string, directions: Record<string, BudgetDirection>): Finding[] {
  const was = numbersOf(before);
  const now = numbersOf(after);
  const findings: Finding[] = [];
  for (const [name, old] of was) {
    const value = now.get(name);
    const dir = Object.hasOwn(directions, name) ? directions[name] : undefined;
    if (value === old) continue;
    if (value !== undefined && dir !== undefined && !isWorse(dir, value, old)) continue;
    const to = value === undefined ? 'removed' : String(value);
    const why = dir === undefined ? 'its direction is unknown, so a change counts as loosening' : dir === 'down' ? 'a smaller number is better and it went up' : 'a larger number is better and it went down';
    findings.push({file, line: 1, rule: 'guard-loosened', opinion: GUARDS_OPINION, detail: `${name} changed from ${old} to ${to} (${why}); ${PROCEED}`});
  }
  return findings;
}

export function deletedFile(file: string, kind: 'guard' | 'test'): Finding {
  return {file, line: 1, rule: `${kind}-deleted`, opinion: GUARDS_OPINION, detail: `the ${kind} file is deleted; ${PROCEED}`};
}

const SKIP = /\b(?:it|test|describe)\.(?:skip|only|todo)\b|\bxit\b|\bxdescribe\b|\bpytest\.mark\.skip\b/;

/** Added lines of a test file that skip, focus or stub a test. */
export function skipsIn(file: string, added: Array<{line: number; text: string}>): Finding[] {
  return added
    .filter(a => SKIP.test(a.text))
    .map(a => ({
      file,
      line: a.line,
      rule: 'test-skipped',
      opinion: GUARDS_OPINION,
      detail: `a test is skipped or focused (${SKIP.exec(a.text)?.[0]}); ${PROCEED}`,
    }));
}

/** The added lines of one file in a `git diff -U0` text, with their line numbers in the new file. */
export function addedLines(diff: string): Array<{line: number; text: string}> {
  const out: Array<{line: number; text: string}> = [];
  let line = 0;
  for (const raw of diff.split('\n')) {
    const hunk = /^@@ -\S+ \+(\d+)/.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (line === 0 || raw.startsWith('+++') || raw.startsWith('---')) continue;
    if (raw.startsWith('+')) out.push({line: line++, text: raw.slice(1)});
  }
  return out;
}

/** The text under a ticket's `## Decisions` heading, up to the next heading of that level or above. */
export function decisionsText(body: string): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex(l => /^##\s+Decisions\s*$/i.test(l.trim()));
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(l => /^#{1,2}\s/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** Findings the Decisions text does not name by file path; pure. */
export function withoutDecided(findings: Finding[], decisions: string): Finding[] {
  return findings.filter(f => !decisions.includes(f.file));
}

export function matches(files: string[], globs: string[]): string[] {
  const res = globs.map(globToRegExp);
  return files.filter(f => res.some(re => re.test(f)));
}
