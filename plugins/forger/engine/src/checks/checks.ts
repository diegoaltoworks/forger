/**
 * `check`: one command that runs every check the installed packs declare, in
 * the lock's order, and folds in the project's waivers. Which checks run and
 * how results combine are pure; only `runChecks` reads the project.
 */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {runArchCheck} from './arch';
import {runDecisionsCheck} from './decisions';
import {runDocsCheck} from './docs';
import type {CommandRunner} from '../ports';
import {runSafetyCheck} from './safety';
import {runCoverageCheck, runTestsCheck} from './testing';
import {runUiCheck} from './ui';
import {listOpinions, LOCK_PATH, loadPacks, parseLock, type Lock, type LoadedPack, type Opinion} from '../packs';
import {applyWaivers, parseWaivers, staleWaivers, WAIVERS_PATH, type Finding, type WaivedFinding, type Waiver} from './waivers';
import {forgerPath} from '../config';

export type CheckStatus = 'passed' | 'failed' | 'waived';

export interface CheckResult {
  check: string;
  /** The installed opinions this check enforces, so a reader sees what is asserted, not just a status. */
  opinions: string[];
  status: CheckStatus;
  violations: Finding[];
  waived: WaivedFinding[];
}

export interface CheckReport {
  ok: boolean;
  results: CheckResult[];
  /** Every waiver in force, matched or not. */
  waivers: Waiver[];
  staleWaivers: Waiver[];
}

export interface CheckContext {
  projectRoot: string;
  run: CommandRunner;
}

/** Every check forger can run; a pack's manifest names these by id. */
export const CHECKS: Record<string, (ctx: CheckContext) => Finding[]> = {
  docs: ctx => runDocsCheck(ctx.projectRoot, ctx.run),
  arch: ctx => runArchCheck(ctx.projectRoot, ctx.run),
  decisions: ctx => runDecisionsCheck(ctx.projectRoot, ctx.run),
  safety: ctx => runSafetyCheck(ctx.projectRoot, ctx.run),
  tests: ctx => runTestsCheck(ctx.projectRoot, ctx.run),
  coverage: ctx => runCoverageCheck(ctx.projectRoot, ctx.run),
  ui: ctx => runUiCheck(ctx.projectRoot, ctx.run),
};

/** The check ids of the installed packs, in lock order, each once. An installed pack that cannot be found is an error. */
export function checksToRun(available: LoadedPack[], lock: Lock, known: string[] = Object.keys(CHECKS)): string[] {
  const ids: string[] = [];
  for (const locked of lock.packs) {
    const pack = available.find(a => a.manifest.id === locked.id);
    if (!pack) throw new Error(`Pack ${locked.id} is in ${LOCK_PATH} but not available in this plugin`);
    for (const c of pack.manifest.checks) {
      if (!known.includes(c)) throw new Error(`Pack ${locked.id} declares check ${c}, which forger cannot run`);
      if (!ids.includes(c)) ids.push(c);
    }
  }
  return ids;
}

export function buildReport(
  findings: Array<{check: string; findings: Finding[]}>,
  waivers: Waiver[],
  opinions: Array<Pick<Opinion, 'id' | 'check'>> = []
): CheckReport {
  const results = findings.map(({check, findings: fs}): CheckResult => {
    const {violations, waived} = applyWaivers(fs, waivers);
    const status: CheckStatus = violations.length > 0 ? 'failed' : waived.length > 0 ? 'waived' : 'passed';
    return {check, opinions: opinions.filter(o => o.check === check).map(o => o.id), status, violations, waived};
  });
  return {
    ok: results.every(r => r.status !== 'failed'),
    results,
    waivers,
    staleWaivers: staleWaivers(findings.flatMap(f => f.findings), waivers),
  };
}

export function formatReport(report: CheckReport): string {
  const lines: string[] = [];
  for (const r of report.results) {
    lines.push(`${r.check}: ${r.status}`);
    for (const v of r.violations) lines.push(`  ${v.file}:${v.line}: ${v.opinion}: ${v.rule}: ${v.detail}`);
    for (const w of r.waived) lines.push(`  waived ${w.file}:${w.line}: ${w.opinion} (${w.waiver.reason}; approved by ${w.waiver.approved_by})`);
  }
  for (const w of report.staleWaivers) lines.push(`stale waiver: ${w.opinion} ${w.path} matches nothing; delete it`);
  if (report.results.length === 0) lines.push('no checks declared by the installed packs');
  return lines.join('\n');
}

export function runChecks(projectRoot: string, pluginRoot: string, run: CommandRunner): CheckReport {
  const lockPath = forgerPath(projectRoot, LOCK_PATH);
  if (!existsSync(lockPath)) throw new Error(`${LOCK_PATH} not found; run setup to install packs`);
  const lock = parseLock(readFileSync(lockPath, 'utf-8'));
  const available = loadPacks(pluginRoot);
  const ids = checksToRun(available, lock);
  const waiversPath = forgerPath(projectRoot, WAIVERS_PATH);
  const waivers = existsSync(waiversPath) ? parseWaivers(readFileSync(waiversPath, 'utf-8')) : [];
  const ctx: CheckContext = {projectRoot, run};
  return buildReport(ids.map(check => ({check, findings: CHECKS[check](ctx)})), waivers, listOpinions(available, lock));
}
