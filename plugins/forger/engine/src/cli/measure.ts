import {existsSync, readdirSync, readFileSync} from 'fs';
import {homedir} from 'os';
import {join} from 'path';

import {readAllVerdicts, readEvents, readSchedule} from '../loop';
import {buildComparisonReport, DEFAULT_PRICES, mergePrices, sessionCostUsd, type PriceTable, computeMeasures, diffReports, type ComparisonReport, formatMeasures, parseBudgets, parseIterationLog, type CiRun, type IterationRecord} from '../supervisor';
import type {Command} from './command';

/** The transcript a session left, searched under every project folder of the harness's config dir; null when there is none. */
function readTranscript(sessionId: string): string | null {
  const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
  if (!existsSync(projects)) return null;
  for (const dir of readdirSync(projects)) {
    const file = join(projects, dir, `${sessionId}.jsonl`);
    if (existsSync(file)) return readFileSync(file, 'utf-8');
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

export const measure: Command = {
  name: 'measure',
  needs: 'config',
  flags: ['json', 'last', 'report', 'diff'],
  help: `  measure [--json] [--last N] [--report]
  measure --diff A.json B.json
                   Runs, failures by cause, time, budget cap, cost from the session transcripts (unknown without one; prices in .forger/prices.json override the defaults) and CI rounds per ticket; merges per hour by parallelism, conflicts, rework, redone tickets, owner interventions.
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
    const measures = computeMeasures({
      iterations,
      budgets,
      sessionCosts,
      verdicts: readAllVerdicts(join(projectRoot, config.paths.verdicts)),
      schedule: readSchedule(join(outDir, 'schedule-decisions.jsonl')),
      events: readEvents(join(projectRoot, config.paths.events)),
      ciRuns,
      last: values.last === undefined ? null : parseInt(values.last, 10),
    });
    if (values.report) {
      console.log(JSON.stringify(buildComparisonReport(measures)));
      return;
    }
    console.log(values.json ? JSON.stringify(measures) : formatMeasures(measures));
  },
};
