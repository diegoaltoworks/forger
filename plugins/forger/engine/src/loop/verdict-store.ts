/**
 * Reading the verdict records `verify` writes (ADR 0010), for the two readers
 * that act on them: `merge`, which refuses without a passing one, and the
 * engine, which tells a verified merge from an unverified one.
 */

import {existsSync, readdirSync, readFileSync} from 'fs';
import {dirname, isAbsolute, join} from 'path';

import {isProjectRoot} from '../config';
import type {CommandRunner} from '../ports';
import type {Decision} from './verdict';
import type {VerdictRecord} from './verify-input';

/**
 * The main checkout a run belongs to. A worker's worktree shares its git
 * directory with it, and the worktree is removed after the run, so state the
 * engine reads afterwards must be kept in the main checkout, not in the
 * worktree. Outside a worktree, or when git cannot tell, it is `projectRoot`.
 */
export function loopRootOf(run: CommandRunner, projectRoot: string, isRoot: (dir: string) => boolean = isProjectRoot): string {
  let common: string;
  try {
    common = run('git rev-parse --path-format=absolute --git-common-dir').trim();
  } catch {
    return projectRoot;
  }
  if (!common || !isAbsolute(common)) return projectRoot;
  const root = dirname(common);
  return isRoot(root) ? root : projectRoot;
}

/** The one place verdicts are written and read, whichever checkout the command runs in. */
export function verdictsHome(run: CommandRunner, projectRoot: string, verdictsPath: string, isRoot?: (dir: string) => boolean): string {
  return join(loopRootOf(run, projectRoot, isRoot), verdictsPath);
}

/**
 * The decision the engine counts for a PR's head: the record when there is
 * one, else the `forger/verify` commit status `verify` set on that head, so a
 * record lost with a worktree does not turn a verified merge into an unverified one.
 */
export function recordedDecision(records: VerdictRecord[], head: string | null, statusPassed: boolean): Decision | null {
  return decisionForHead(records, head) ?? (head && statusPassed ? 'pass' : null);
}

/** Every readable record kept for a PR, whatever head it was made at. */
export function readVerdicts(dir: string, pr: number): VerdictRecord[] {
  if (!existsSync(dir)) return [];
  const prefix = `pr-${pr}-`;
  const records: VerdictRecord[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(prefix) || !name.endsWith('.json')) continue;
    try {
      const r = JSON.parse(readFileSync(join(dir, name), 'utf-8')) as VerdictRecord;
      if (r && r.pr === pr && typeof r.head === 'string') records.push(r);
    } catch {
      // an unreadable record counts as no record
    }
  }
  return records;
}

/** The decision recorded for exactly this head; null when there is none (a record for an older head is stale). */
export function decisionForHead(records: VerdictRecord[], head: string | null): Decision | null {
  if (!head) return null;
  return records.find(r => r.head === head)?.decision ?? null;
}

/** Why a PR may not merge on its verdicts; null when its head has a passing one. */
export function verdictRefusal(records: VerdictRecord[], head: string | null): string | null {
  if (!head) return 'cannot tell the PR head, so no verdict can be matched to it';
  const record = records.find(r => r.head === head);
  if (!record) {
    return records.length > 0
      ? `the verdict is stale: it was made for an earlier head, not ${head.slice(0, 7)}; run verify again`
      : 'no verdict recorded for the PR head; run verify first';
  }
  if (record.decision === 'pass') return null;
  const open = record.entries.filter(e => e.verdict !== 'met');
  const named = open.map(e => `${e.criterion} (${e.verdict})`).join(', ') || 'none named';
  const why = record.decision === 'block' ? 'the verdict blocks the merge' : 'the verdict is unclear and blocks the merge';
  return `${why}; criteria not met: ${named}`;
}

/** Every readable record for every PR. */
export function readAllVerdicts(dir: string): VerdictRecord[] {
  if (!existsSync(dir)) return [];
  const prs = new Set<number>();
  for (const name of readdirSync(dir)) {
    const m = /^pr-(\d+)-.+\.json$/.exec(name);
    if (m) prs.add(parseInt(m[1], 10));
  }
  return [...prs].flatMap(pr => readVerdicts(dir, pr));
}
