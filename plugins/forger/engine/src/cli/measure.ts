import {existsSync, readdirSync, readFileSync} from 'fs';
import {join} from 'path';

import {readEvents} from '../loop';
import {computeMeasures, formatMeasures, parseBudgets, parseIterationLog, type CiRun, type IterationRecord} from '../supervisor';
import type {Command} from './command';

export const measure: Command = {
  name: 'measure',
  needs: 'config',
  flags: ['json', 'last'],
  help: `  measure [--json] [--last N]
                   Runs, failures by cause, time, budget cap and CI rounds per ticket`,
  run(ctx) {
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
    const measures = computeMeasures({
      iterations,
      budgets: existsSync(workLog) ? parseBudgets(readFileSync(workLog, 'utf-8')) : [],
      events: readEvents(join(projectRoot, config.paths.events)),
      ciRuns,
      last: values.last === undefined ? null : parseInt(values.last, 10),
    });
    console.log(values.json ? JSON.stringify(measures) : formatMeasures(measures));
  },
};
