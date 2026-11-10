/**
 * `check`: one command that runs every check the installed packs declare, in
 * the lock's order, and folds in the project's waivers. Which checks run and
 * how results combine are pure; only `runChecks` reads the project.
 */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {runArchCheckOutput} from './arch';
import {runBudgetsCheck} from './budgets';
import {runDecisionsCheck} from './decisions';
import {runDocsCheck} from './docs';
import {runGuardsCheck} from './guards';
import {runHooksCheck} from './hooks';
import {runDeliveryCheck} from './delivery';
import {runJourneysCheck} from './journeys';
import type {CommandRunner, Harness, SpecProvider} from '../ports';
import {runSafetyCheckOutput} from './safety';
import {runSpecDecision} from './spec';
import {runStructureCheck} from './structure';
import {runCoverageCheck, runTestsCheck} from './testing';
import {runUiCheckOutput} from './ui';
import {listOpinions, LOCK_PATH, loadPacks, parseLock, type Lock, type LoadedPack, type Opinion} from '../packs';
import {applyWaivers, parseWaivers, staleWaivers, WAIVERS_PATH, type Finding, type WaivedFinding, type Waiver} from './waivers';
import {forgerPath} from '../config';
import {classifyGaps, gapsFail, gapsOpen, type Gap, type ReportedGap} from './gaps';

/** `unmeasured`: nothing failed, but something could not be measured, so it is not a pass. */
export type CheckStatus = 'passed' | 'failed' | 'waived' | 'unmeasured';

export interface CheckResult {
  check: string;
  /** The installed opinions this check enforces, so a reader sees what is asserted, not just a status. */
  opinions: string[];
  status: CheckStatus;
  violations: Finding[];
  waived: WaivedFinding[];
  /** What the check could not measure, apart from its violations. */
  gaps: ReportedGap[];
}

export interface CheckReport {
  ok: boolean;
  results: CheckResult[];
  /** Every gap of every check, so a reader sees what was not measured without walking the results. */
  gaps: ReportedGap[];
  /** Every waiver in force, matched or not. */
  waivers: Waiver[];
  staleWaivers: Waiver[];
}

export interface CheckContext {
  projectRoot: string;
  run: CommandRunner;
  /** Where requirement reports come from; absent means none installed. */
  spec?: SpecProvider;
  /** The harness whose hook settings `check hooks` reads; absent means none to check. */
  harness?: Harness;
}

/** A check's output: findings, and what it could not measure. */
export interface CheckOutput {
  findings: Finding[];
  gaps: Gap[];
}

/** The project's `.forger/waivers.json`; none when the file is absent. */
export function loadWaivers(projectRoot: string): Waiver[] {
  const file = forgerPath(projectRoot, WAIVERS_PATH);
  return existsSync(file) ? parseWaivers(readFileSync(file, 'utf-8')) : [];
}

/** Every check forger can run; a pack's manifest names these by id. */
export const CHECKS: Record<string, (ctx: CheckContext) => Finding[] | CheckOutput> = {
  docs: ctx => runDocsCheck(ctx.projectRoot, ctx.run),
  arch: ctx => runArchCheckOutput(ctx.projectRoot, ctx.run),
  decisions: ctx => runDecisionsCheck(ctx.projectRoot, ctx.run),
  guards: ctx => runGuardsCheck(ctx.projectRoot, ctx.run),
  safety: ctx => runSafetyCheckOutput(ctx.projectRoot, ctx.run),
  delivery: ctx => runDeliveryCheck(ctx.projectRoot),
  journeys: ctx => runJourneysCheck(ctx.projectRoot, ctx.run),
  budgets: ctx => runBudgetsCheck(ctx.projectRoot, ctx.run),
  tests: ctx => runTestsCheck(ctx.projectRoot, ctx.run),
  coverage: ctx => runCoverageCheck(ctx.projectRoot, ctx.run),
  structure: ctx => {
    const {findings, gaps} = runStructureCheck(ctx.projectRoot, ctx.run);
    return {findings, gaps};
  },
  ui: ctx => runUiCheckOutput(ctx.projectRoot, ctx.run),
  hooks: ctx => runHooksCheck(ctx.projectRoot, ctx.harness),
  spec: ctx => {
    const {findings, gaps} = runSpecDecision(ctx.run, ctx.spec);
    return {findings, gaps};
  },
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
  findings: Array<{check: string; findings: Finding[]; gaps?: Gap[]}>,
  waivers: Waiver[],
  opinions: Array<Pick<Opinion, 'id' | 'check'>> = []
): CheckReport {
  const results = findings.map(({check, findings: fs, gaps: raw = []}): CheckResult => {
    const {violations, waived} = applyWaivers(fs, waivers);
    const gaps = classifyGaps(raw, waivers);
    const status: CheckStatus =
      violations.length > 0 || gapsFail(gaps) ? 'failed' : gapsOpen(gaps) ? 'unmeasured' : waived.length > 0 || gaps.length > 0 ? 'waived' : 'passed';
    return {check, opinions: opinions.filter(o => o.check === check).map(o => o.id), status, violations, waived, gaps};
  });
  return {
    ok: results.every(r => r.status !== 'failed'),
    results,
    gaps: results.flatMap(r => r.gaps),
    waivers,
    staleWaivers: staleWaivers(findings.flatMap(f => f.findings), waivers),
  };
}

export function formatReport(report: CheckReport): string {
  const lines: string[] = [];
  for (const r of report.results) {
    lines.push(`${r.check}: ${r.status}`);
    for (const v of r.violations) lines.push(`  ${v.file}:${v.line}: ${v.opinion}: ${v.rule}: ${v.detail}`);
    for (const g of r.gaps) lines.push(`  ${g.waiver ? 'waived gap' : `gap (${g.severity})`} ${g.file}: ${g.opinion}: ${g.modality}: ${g.detail}`);
    for (const w of r.waived) lines.push(`  waived ${w.file}:${w.line}: ${w.opinion} (${w.waiver.reason}; approved by ${w.waiver.approved_by})`);
  }
  for (const w of report.staleWaivers) lines.push(`stale waiver: ${w.opinion} ${w.path} matches nothing; delete it`);
  if (report.results.length === 0) lines.push('no checks declared by the installed packs');
  return lines.join('\n');
}

export function runChecks(projectRoot: string, pluginRoot: string, run: CommandRunner, spec?: SpecProvider, harness?: Harness): CheckReport {
  const lockPath = forgerPath(projectRoot, LOCK_PATH);
  if (!existsSync(lockPath)) throw new Error(`${LOCK_PATH} not found; run setup to install packs`);
  const lock = parseLock(readFileSync(lockPath, 'utf-8'));
  const available = loadPacks(pluginRoot);
  const ids = checksToRun(available, lock);
  const waivers = loadWaivers(projectRoot);
  const ctx: CheckContext = {projectRoot, run, spec, harness};
  const outputs = ids.map(check => {
    const out = CHECKS[check](ctx);
    return {check, ...(Array.isArray(out) ? {findings: out} : out)};
  });
  return buildReport(outputs, waivers, listOpinions(available, lock));
}

/**
 * The unwaived findings of the hooks gate, read before a worker starts: a gate
 * that is red on a clean main would cost a whole iteration to discover. Empty
 * when no installed pack declares the check, or the lock is absent.
 */
export function hooksGateProblems(projectRoot: string, pluginRoot: string, harness?: Harness): Finding[] {
  const lockPath = forgerPath(projectRoot, LOCK_PATH);
  if (!existsSync(lockPath)) return [];
  if (!checksToRun(loadPacks(pluginRoot), parseLock(readFileSync(lockPath, 'utf-8'))).includes('hooks')) return [];
  return applyWaivers(runHooksCheck(projectRoot, harness), loadWaivers(projectRoot)).violations;
}

/** The sentence `run` and `orient` give for a red hooks gate; null when it is green. */
export function hooksGateRefusal(findings: Finding[]): string | null {
  if (findings.length === 0) return null;
  return `the hooks gate fails (${findings.map(f => `${f.file}: ${f.rule}`).join('; ')}); run \`work.ts setup\` in this repository to add what is missing, then commit it`;
}
