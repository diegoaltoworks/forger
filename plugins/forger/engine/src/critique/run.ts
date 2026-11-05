/**
 * `critique --pr N`: after a change the audience sees, a fresh-context critic
 * holds the captures to the verbatim brief; findings above the threshold are
 * filed as tickets and the rest are reported. A critique never blocks a merge.
 * Everything that touches the world sits behind the injected runner, agent and
 * tracker.
 */

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {Tier} from '../config';
import {contractSuffix, NO_FACTS, validateContract} from '../pipeline';
import type {AgentRunner, CommandRunner} from '../ports';
import {briefFrom, buildCritiqueInput, isVisualChange, splitFindings, ticketFor, type Critique, type Finding, type Severity} from './critique';

export const RESULT_FILE = 'critique.json';

/** Where findings become tickets; the project's tracker supplies it. Returns a handle (an issue URL). */
export interface CritiqueTracker {
  fileTicket(title: string, body: string): string;
}

export interface CritiqueOptions {
  pr: number;
  /** Run even when the change touches no visual path (the supervisor asks on demand). */
  force: boolean;
  threshold: Severity;
  /** Globs of what the audience sees; the captures directory always counts. */
  visualPaths: string[];
  /** Directory holding the critique records. */
  recordsDir: string;
  tier: Tier;
  model: string;
  /** The command the harness is asked to run; it carries the critic's prompt. */
  critiqueCommand: string;
  timeoutMinutes: number;
  killGraceSeconds: number;
  sessionId: string;
  now?: () => Date;
}

export type CritiqueResult =
  | {status: 'skipped'; pr: number; reason: string}
  | {status: 'invalid'; pr: number; head: string; problems: string[]}
  | {status: 'critiqued'; pr: number; head: string; at: string; dimensions: Critique['dimensions']; filed: Array<Finding & {ticket: string}>; reported: Finding[]};

const CAPTURE_DIR = 'docs/screenshots/';
const CAPTURE_FILE = /\.(png|jpe?g|gif|webp|webm|mp4)$/i;

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

const lines = (out: string): string[] => out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

export function critiqueFile(dir: string, pr: number, head: string): string {
  return join(dir, `pr-${pr}-${head}.json`);
}

export async function critiquePr(run: CommandRunner, agent: AgentRunner, tracker: CritiqueTracker, opts: CritiqueOptions): Promise<CritiqueResult> {
  const {pr} = opts;
  const changed = lines(run(`gh pr diff ${pr} --name-only`));
  if (!opts.force && !isVisualChange(changed, opts.visualPaths)) {
    return {status: 'skipped', pr, reason: 'the change touches no path the audience sees'};
  }
  const head = (JSON.parse(run(`gh pr view ${pr} --json headRefOid`)) as {headRefOid?: string}).headRefOid;
  if (!head) throw new Error(`cannot read PR #${pr}`);

  run(`git fetch origin pull/${pr}/head`);
  const dir = mkdtempSync(join(tmpdir(), `forger-critique-${pr}-`));
  run(`git worktree add --detach ${shellQuote(dir)} ${head}`);
  try {
    const plans = lines(run(`git -C ${shellQuote(dir)} ls-files 'docs/plan*.md'`));
    const brief = plans.map(p => briefFrom(readFileSync(join(dir, p), 'utf-8'))).find(b => b !== null) ?? null;
    if (brief === null) return {status: 'skipped', pr, reason: 'no plan doc holds a verbatim brief, so there is nothing to judge against'};
    const captures = lines(run(`git -C ${shellQuote(dir)} ls-files ${shellQuote(CAPTURE_DIR)}`)).filter(c => CAPTURE_FILE.test(c));
    if (captures.length === 0) return {status: 'skipped', pr, reason: `no capture under ${CAPTURE_DIR} to look at; run screenshot first`};

    const resultPath = join(dir, RESULT_FILE);
    const suffix = contractSuffix('critique', resultPath);
    const facts = {...NO_FACTS, fileExists: (p: string) => existsSync(join(dir, p))};
    let problems: string[] = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      rmSync(resultPath, {force: true});
      await agent.run({
        prompt: buildCritiqueInput({brief, captures, suffix, problems}),
        sessionId: opts.sessionId,
        tier: opts.tier,
        model: opts.model,
        workerCommand: opts.critiqueCommand,
        cwd: dir,
        timeoutMinutes: opts.timeoutMinutes,
        killGraceSeconds: opts.killGraceSeconds,
      });
      let value: unknown;
      try {
        value = JSON.parse(readFileSync(resultPath, 'utf-8'));
      } catch {
        problems = [`${RESULT_FILE} was not written as valid JSON`];
        continue;
      }
      const checked = validateContract('critique', value, facts);
      if (!checked.ok) {
        problems = checked.problems;
        continue;
      }
      return finish(tracker, opts, head, value as Critique);
    }
    return {status: 'invalid', pr, head, problems};
  } finally {
    run(`git worktree remove --force ${shellQuote(dir)}`);
  }
}

function finish(tracker: CritiqueTracker, opts: CritiqueOptions, head: string, critique: Critique): CritiqueResult {
  const {file, report} = splitFindings(critique.findings, opts.threshold);
  const filed = file.map(f => {
    const t = ticketFor(f, opts.pr);
    return {...f, ticket: tracker.fileTicket(t.title, t.body)};
  });
  const result: CritiqueResult = {status: 'critiqued', pr: opts.pr, head, at: (opts.now?.() ?? new Date()).toISOString(), dimensions: critique.dimensions, filed, reported: report};
  mkdirSync(opts.recordsDir, {recursive: true});
  writeFileSync(critiqueFile(opts.recordsDir, opts.pr, head), JSON.stringify(result, null, 2) + '\n');
  return result;
}
