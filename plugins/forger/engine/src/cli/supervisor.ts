import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {handedOver, listRepoLabels, loopLabels, missingLabels, readAllVerdicts} from '../loop';
import {buildReport, formatReport, orient as orientPlan} from '../supervisor';
import type {Command, CommandContext} from './command';

function supervise(which: 'orient' | 'report') {
  return (ctx: CommandContext): void => {
    const {values, projectRoot, config, runner} = ctx;
    const status = runner.statusReport();
    const haltFile = join(projectRoot, config.paths.halt);
    const branch = ctx.run()('git branch --show-current');
    let missing: string[] | undefined;
    if (config.tracker.kind === 'github') {
      try {
        missing = missingLabels(loopLabels(config.tracker.label), listRepoLabels(ctx.run())).map(l => l.name);
      } catch {
        missing = undefined;
      }
    }
    const plan = orientPlan({
      backlogAnomalies: ctx.backlog.report().anomalies,
      missingLabels: missing,
      status,
      haltReason: existsSync(haltFile) ? readFileSync(haltFile, 'utf-8') : null,
      branch,
      baseBranch: config.base_branch,
    });
    const out = which === 'orient' ? plan : buildReport({
          status,
          plan,
          branch,
          baseBranch: config.base_branch,
          handedOver: handedOver(readAllVerdicts(join(projectRoot, config.paths.verdicts)), config.limits.maxVerifyRounds),
        });
    if (values.json) console.log(JSON.stringify(out));
    else if (which === 'report') console.log(formatReport(out as ReturnType<typeof buildReport>));
    else console.log([`${plan.action}: ${plan.reason}`, ...plan.anomalies.map(a => `! ${a}`)].join('\n'));
  };
}

export const orient: Command = {
  name: 'orient',
  needs: 'loop',
  flags: ['json'],
  help: '  orient [--json]  What the supervisor should do on arrival: surface_halt, attach, start, nothing_to_do',
  run: supervise('orient'),
};

export const report: Command = {
  name: 'report',
  needs: 'loop',
  flags: ['json'],
  help: '  report [--json]  Merged, in progress (real branch), next, waiting on the owner',
  run: supervise('report'),
};
