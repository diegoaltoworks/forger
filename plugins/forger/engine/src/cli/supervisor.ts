import {hostname} from 'os';
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';

import {readBaseSync, decideHalt, pidAlive, viewLease, standingHalt, parseAllEvents, GhTrackerHalt, requiresVerifyStatus, handedOver, listRepoLabels, loopLabels, missingLabels, readAllVerdicts, verdictsHome, setAsideReasons} from '../loop';
import {describeBlocked} from '../backlog';
import {detectLayout} from '../config';
import {gitignoreLines} from '../packs';
import {engineStartLine, readEngineStart} from './detach';
import {buildReport, formatReport, mergedInPeriod, orient as orientPlan, failedDeliveryItems, proposedAdrs, reportPeriod, uncausedClearItems, waitingIssues, ownerReviewPrs, OWNER_LABELS, type AdrText, type OwnerReviewPr, type MergedPrFact, type OwnerItem, type WaitingIssue} from '../supervisor';
import {hooksGateProblems, hooksGateRefusal} from '../checks';
import type {Command, CommandContext} from './command';
import {harnessOfRoot} from './harness-of';
import {gatherMeasures} from './measure';
import {reportRepos} from './multi';

const LAST_REPORT = 'last-report.json';

function lastReportAt(file: string): string | null {
  try {
    return (JSON.parse(readFileSync(file, 'utf-8')) as {at?: string}).at ?? null;
  } catch {
    return null;
  }
}

/** Open issues parked for the owner and Proposed ADRs; the tracker read fails soft into one item saying so. */
function ownerWaiting(ctx: CommandContext): OwnerItem[] {
  const out: OwnerItem[] = [];
  try {
    const run = ctx.run();
    const issues: WaitingIssue[] = [];
    for (const label of OWNER_LABELS) {
      const raw = JSON.parse(run(`gh issue list --state open --label ${label} --limit 100 --json number,title,labels,body`)) as {number: number; title: string; labels: {name: string}[]; body: string}[];
      for (const i of raw) if (!issues.some(x => x.number === i.number)) issues.push({number: i.number, title: i.title, labels: i.labels.map(l => l.name), body: i.body ?? ''});
    }
    out.push(...waitingIssues(issues, setAsideReasons(parseAllEvents(ctx.stateStore.readEvents()))));
    out.push(...ownerReviewPrs(JSON.parse(run('gh pr list --state open --label owner-review --limit 100 --json number,title,url')) as OwnerReviewPr[]));
  } catch {
    out.push({question: 'The issues waiting on you could not be read from the tracker', recommendation: 'run `gh issue list --label needs-info` yourself', because: 'gh failed or is offline, so this list may be incomplete'});
  }
  const dir = join(ctx.projectRoot, 'docs/adr');
  if (existsSync(dir)) {
    const adrs: AdrText[] = readdirSync(dir).filter(f => /^\d.*\.md$/.test(f)).map(name => ({name, text: readFileSync(join(dir, name), 'utf-8')}));
    out.push(...proposedAdrs(adrs));
  }
  return out;
}

function haltReasonOf(file: string | null, tracker: {label: boolean; reason: string | null}): string | null {
  const d = decideHalt({label: tracker.label, labelReason: tracker.reason, file});
  return d.halted ? (file !== null && d.source === 'file' ? file : d.reason) : null;
}

/** Not fatal: an unreadable lock or waiver file leaves the gate unreported, and `run` reports it when it refuses. */
function hooksGate(ctx: CommandContext): string | null {
  try {
    return hooksGateRefusal(hooksGateProblems(ctx.projectRoot, ctx.pluginRoot, harnessOfRoot(ctx.projectRoot)));
  } catch {
    return null;
  }
}

function supervise(which: 'orient' | 'report') {
  return (ctx: CommandContext): void => {
    const {values, projectRoot, config, runner} = ctx;
    const status = runner.statusReport();
    const haltFile = join(projectRoot, config.paths.halt);
    const branch = ctx.run()('git branch --show-current');
    let missing: string[] | undefined;
    let requiresVerify: boolean | null | undefined;
    if (config.tracker.kind === 'github') {
      requiresVerify = requiresVerifyStatus(ctx.capture(), config.base_branch);
      try {
        missing = missingLabels(loopLabels(config.tracker.label), listRepoLabels(ctx.run())).map(l => l.name);
      } catch {
        missing = undefined;
      }
    }
    const lease = viewLease(ctx.stateStore.readLease(), new Date(), {host: hostname(), isAlive: pidAlive});
    const plan = orientPlan({
      lease,
      baseSync: readBaseSync(ctx.run(), config.base_branch, gitignoreLines(detectLayout(projectRoot).dir)),
      backlogAnomalies: ctx.backlog.report().anomalies,
      blockers: ctx.backlog.blocked().map(b => describeBlocked([b])),
      missingLabels: missing,
      requiresVerify,
      hooksGate: hooksGate(ctx),
      status,
      haltReason: haltReasonOf(
        existsSync(haltFile) ? readFileSync(haltFile, 'utf-8') : null,
        config.tracker.kind === 'github' ? new GhTrackerHalt(ctx.run()).read() : {label: false, reason: null}
      ),
      branch,
      baseBranch: config.base_branch,
    });
    const marker = join(projectRoot, config.paths.output, LAST_REPORT);
    const period = reportPeriod(values.since, lastReportAt(marker));
    let merged: string[] | undefined;
    if (which === 'report') {
      try {
        const prs = (JSON.parse(ctx.run()('gh pr list --state merged --limit 200 --json number,title,mergedAt')) as MergedPrFact[]);
        merged = mergedInPeriod(prs, period);
      } catch {
        merged = undefined;
      }
    }
    const events = parseAllEvents(ctx.stateStore.readEvents());
    const out = which === 'orient' ? {...plan, engine_start: readEngineStart(ctx)} : buildReport({
          ownerWaiting: [...ownerWaiting(ctx), ...uncausedClearItems(events), ...failedDeliveryItems(events)],
          merged,
          period,
          status,
          measures: gatherMeasures(ctx),
          plan,
          haltKind: standingHalt(events)?.event ?? null,
          recovered: events.filter(e => e.event === 'recovered').map(e => `${e.ticket ?? 'no ticket'}: ${e.reason ?? 'recovered'} (${e.at})`),
          flakyGates: events.filter(e => e.event === 'flaky_gate').map(e => e.reason ?? 'unnamed gate'),
          branch,
          baseBranch: config.base_branch,
          handedOver: handedOver(readAllVerdicts(verdictsHome(ctx.run(), projectRoot, config.paths.verdicts)), config.limits.maxVerifyRounds),
        });
    if (which === 'report' && values.since === undefined) {
      mkdirSync(join(projectRoot, config.paths.output), {recursive: true});
      writeFileSync(marker, JSON.stringify({at: new Date().toISOString()}));
    }
    if (values.json) console.log(JSON.stringify(out));
    else if (which === 'report') console.log(formatReport(out as ReturnType<typeof buildReport>));
    else console.log([`${plan.action}: ${plan.reason}`, engineStartLine(ctx), ...plan.anomalies.map(a => `! ${a}`)].join('\n'));
  };
}

export const orient: Command = {
  name: 'orient',
  needs: 'loop',
  flags: ['json', 'from'],
  help: '  orient [--json] [--from local|branch]  What the supervisor should do on arrival: surface_halt, attach, start, nothing_to_do',
  run: supervise('orient'),
};

export const report: Command = {
  name: 'report',
  needs: 'none',
  flags: ['json', 'since', 'from', 'repos'],
  help: '  report [--json] [--since DATE] [--from local|branch] [--repos PATH,PATH]  One report across the loops at those paths, every item tagged by repository. Merged since the last report (or --since), in progress (real branch), next, waiting on the owner (needs-info, needs-human, needs-triage issues and Proposed ADRs); cost per merged ticket, rework rate, escaped defects, owner interventions',
  run(ctx) {
    if (ctx.values.repos !== undefined) return reportRepos(ctx);
    void ctx.runner;
    return supervise('report')(ctx);
  },
};
