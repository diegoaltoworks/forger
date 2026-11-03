import {existsSync, readdirSync, readFileSync} from 'fs';
import {homedir} from 'os';
import {join} from 'path';

import {readAllEvents, readAllVerdicts, readEvents, readSchedule} from '../loop';
import {buildComparisonReport, DEFAULT_PRICES, mergePrices, sessionCostUsd, type PriceTable, type Measures, computeMeasures, diffReports, parseDiffRanges, parseReplacedRanges, picksToPrs, DEFAULT_REWORK_WINDOW, type MergedPr, type TrackerIssue, type ReworkInputs, type ComparisonReport, formatMeasures, parseBudgets, parseIterationLog, type CiRun, type IterationRecord} from '../supervisor';
import type {Command, CommandContext} from './command';

/** The transcript a session left, searched under every project folder of the harness's config dir; null when there is none. */
function readTranscript(sessionId: string): string | null {
  const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
  if (!existsSync(projects)) return null;
  for (const dir of readdirSync(projects)) {
    const file = join(projects, dir, `${sessionId}.jsonl`);
    if (existsSync(file)) return readFileSync(file, 'utf-8');
  }
  // The work log of older runs holds only the first characters of the id.
  if (sessionId.length >= 8) {
    for (const dir of readdirSync(projects)) {
      const found = readdirSync(join(projects, dir)).filter(f => f.startsWith(sessionId) && f.endsWith('.jsonl'));
      if (found.length === 1) return readFileSync(join(projects, dir, found[0]), 'utf-8');
    }
  }
  return null;
}

function readPrices(projectRoot: string): PriceTable {
  const file = join(projectRoot, '.forger/prices.json');
  if (!existsSync(file)) return DEFAULT_PRICES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    throw new Error('.forger/prices.json is not valid JSON');
  }
  const merged = mergePrices(DEFAULT_PRICES, parsed);
  if (merged === null) throw new Error('.forger/prices.json must map a model name to {input, output, cache_read, cache_write} dollars per million tokens');
  return merged;
}

interface GhPr {
  number: number;
  title: string;
  body: string;
  closingIssuesReferences?: {number: number}[];
}

/** Merged PRs oldest first with their touched lines, and the issues; null when gh cannot read them. */
function gatherChanges(run: (cmd: string) => string, iterations: IterationRecord[], picked: {iteration: number; ticket: string | null}[], window: number, limit: number): ReworkInputs | null {
  try {
    const listed = (JSON.parse(run(`gh pr list --state merged --limit ${limit} --json number,title,body,closingIssuesReferences`)) as GhPr[]).reverse();
    const prs: MergedPr[] = listed.map((p, order) => {
      let ranges: MergedPr['ranges'] = [];
      let replaced: MergedPr['ranges'] = [];
      try {
        const diff = run(`gh pr diff ${p.number}`);
        ranges = parseDiffRanges(diff);
        replaced = parseReplacedRanges(diff);
      } catch {
        // A PR whose diff cannot be read has no overlap evidence, not an error.
      }
      return {number: p.number, order, title: p.title, body: p.body ?? '', closes: p.closingIssuesReferences?.[0]?.number ?? null, ranges, replaced};
    });
    const raw = JSON.parse(run(`gh issue list --state all --label bug --limit ${limit} --json number,labels,body`)) as {number: number; labels: {name: string}[]; body: string}[];
    const issues: TrackerIssue[] = raw.map(i => ({number: i.number, labels: i.labels.map(l => l.name), body: i.body ?? ''}));
    return {prs, issues, picks: picksToPrs(picked, iterations, prs), window};
  } catch {
    return null;
  }
}

/** Reads the logs, the transcripts and the tracker into the measures; the arithmetic is in `computeMeasures`. */
export function gatherMeasures(ctx: CommandContext): Measures {
  const {values, projectRoot, config} = ctx;
  const outDir = join(projectRoot, config.paths.output);
  const iterations: IterationRecord[] = existsSync(outDir)
    ? readdirSync(outDir)
        .filter(f => /^iteration-\d+\.log$/.test(f))
        .flatMap(f => parseIterationLog(readFileSync(join(outDir, f), 'utf-8')) ?? [])
    : [];
  const workLog = join(projectRoot, config.paths.log);
  let ciRuns: CiRun[] = [];
  try {
    ciRuns = JSON.parse(ctx.run()('gh run list --limit 500 --json headBranch,event')) as CiRun[];
  } catch {
    // No CI, no gh or offline: CI rounds are reported as unknown.
  }
  const budgets = existsSync(workLog) ? parseBudgets(readFileSync(workLog, 'utf-8')) : [];
  const prices = readPrices(projectRoot);
  const sessionCosts: Record<string, number | null> = {};
  for (const b of budgets) if (b.sessionId !== undefined) sessionCosts[b.sessionId] = sessionCostUsd(readTranscript(b.sessionId), prices);
  const window = values.window === undefined ? DEFAULT_REWORK_WINDOW : parseInt(values.window, 10);
  if (!(window >= 1)) throw new Error('--window must be a whole number of merges, 1 or more');
  const picked = readAllEvents(join(projectRoot, config.paths.events)).filter(e => e.event === 'picked');
  const changes = gatherChanges(ctx.run(), iterations, picked, window, 100);
  const measures = computeMeasures({
    ...(changes === null ? {} : {changes}),
    iterations,
    budgets,
    sessionCosts,
    verdicts: readAllVerdicts(join(projectRoot, config.paths.verdicts)),
    schedule: readSchedule(join(outDir, 'schedule-decisions.jsonl')),
    events: readEvents(join(projectRoot, config.paths.events)),
    ciRuns,
    last: values.last === undefined ? null : parseInt(values.last, 10),
  });
return measures;
}

export const measure: Command = {
  name: 'measure',
  needs: 'config',
  flags: ['json', 'last', 'report', 'diff', 'window'],
  help: `  measure [--json] [--last N] [--window N] [--report]
  measure --diff A.json B.json
                   Runs, failures by cause, time, budget cap, cost from the session transcripts (unknown without one; prices in .forger/prices.json override the defaults) and CI rounds per ticket; merges per hour by parallelism, conflicts, rework, redone tickets, owner interventions.
                   Rework and escaped defects per merged PR: a later merge within --window N merges (default 5) that touches its lines or reverts it, bug issues naming it, and picks that differ from the issue the PR closed.
                   --report prints the five-measure comparison report as JSON; --diff prints the per-measure delta between two saved reports (A is the baseline)`,
  run(ctx) {
    const {values, projectRoot, config, positionals} = ctx;
    if (values.diff) {
      const [a, b] = [positionals[1], positionals[2]];
      if (a === undefined || b === undefined) throw new Error('measure --diff needs two report files: measure --diff A.json B.json');
      const read = (f: string) => JSON.parse(readFileSync(f, 'utf-8')) as ComparisonReport;
      console.log(JSON.stringify(diffReports(read(a), read(b))));
      return;
    }
    const measures = gatherMeasures(ctx);
    if (values.report) {
      console.log(JSON.stringify(buildComparisonReport(measures)));
      return;
    }
    console.log(values.json ? JSON.stringify(measures) : formatMeasures(measures));
  },
};
