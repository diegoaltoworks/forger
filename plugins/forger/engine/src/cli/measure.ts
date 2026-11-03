import {existsSync, readdirSync, readFileSync} from 'fs';
import {join} from 'path';

import {readAllVerdicts, readEvents, readSchedule} from '../loop';
import {buildComparisonReport, computeMeasures, diffReports, type ComparisonReport, formatMeasures, parseBudgets, parseIterationLog, type CiRun, type IterationRecord} from '../supervisor';
import type {Command} from './command';

export const measure: Command = {
  name: 'measure',
  needs: 'config',
  flags: ['json', 'last', 'report', 'diff'],
  help: `  measure [--json] [--last N] [--report]
  measure --diff A.json B.json
                   Runs, failures by cause, time, budget cap and CI rounds per ticket; merges per hour by parallelism, conflicts, rework, redone tickets, owner interventions.
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
    const measures = computeMeasures({
      iterations,
      budgets: existsSync(workLog) ? parseBudgets(readFileSync(workLog, 'utf-8')) : [],
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
