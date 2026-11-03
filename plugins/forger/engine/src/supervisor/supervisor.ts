/**
 * The supervisor's decisions, as pure functions over facts a tool gathered:
 * what to do on arrival, what needs the owner, and the report. The command
 * (`commands/work.md`) calls these through the CLI and keeps only judgement.
 */

import type {HandedOver, StatusReport} from '../loop';
import type {Measures} from './measure';
import {type Period} from './waiting';
import {buildReportMeasures, formatReportMeasures, type ReportMeasures} from './report-measures';

export type OrientAction = 'surface_halt' | 'attach' | 'start' | 'nothing_to_do';

export interface OrientInputs {
  status: StatusReport;
  /** Contents of the HALT file, when it exists. */
  haltReason: string | null;
  /** `git branch --show-current`; empty when detached. */
  branch: string;
  baseBranch: string;
  /** Loop labels the repository lacks; undefined when not checked. */
  missingLabels?: string[];
  /** Dependencies the tickets' text and the tracker disagree on; undefined when not read. */
  backlogAnomalies?: string[];
}

export interface OrientPlan {
  action: OrientAction;
  /** Why, in a sentence the report can quote. */
  reason: string;
  /** Facts that look wrong and deserve a line in the report. */
  anomalies: string[];
}

/**
 * A halt wins over everything: it usually means a ticket finished on a branch
 * and was cut off before the merge, so the supervisor surfaces it and does not
 * clear it. A live runner is attached to, never doubled.
 */
export function orient(i: OrientInputs): OrientPlan {
  const s = i.status;
  const anomalies: string[] = [];
  if (!s.runner.alive && i.branch !== i.baseBranch) {
    anomalies.push(`no runner is alive but the checkout is on "${i.branch || 'detached HEAD'}", not ${i.baseBranch}`);
  }
  if (s.runner.pid !== null && !s.runner.alive) {
    anomalies.push(`the lock names pid ${s.runner.pid}, which is gone`);
  }
  for (const label of i.missingLabels ?? []) {
    anomalies.push(`the label "${label}" the loop relies on does not exist on GitHub; run setup to create it`);
  }
  anomalies.push(...(i.backlogAnomalies ?? []));
  if (s.halted) {
    return {action: 'surface_halt', reason: i.haltReason?.trim() || s.last_error || 'halted, no reason recorded', anomalies};
  }
  if (s.runner.alive) {
    return {action: 'attach', reason: `a runner is alive (pid ${s.runner.pid})`, anomalies};
  }
  if (s.remaining === 0) {
    return {action: 'nothing_to_do', reason: 'the backlog has nothing left; plan the next work', anomalies};
  }
  return {action: 'start', reason: `${s.remaining} ticket(s) remain and no runner is alive`, anomalies};
}

export type Authority = 'alone' | 'alone_and_report' | 'owner' | 'never';

/** The approval table in `docs/04-supervising.md`, one row per action. */
export const APPROVAL_POLICY = {
  file_tickets: 'alone',
  queue_backlog_by_pr: 'alone',
  start_runner: 'alone',
  attach_watcher: 'alone',
  record_note_or_process_rule_by_pr: 'alone',
  stop_runner_on_wrong_base: 'alone_and_report',
  open_pr_for_pushed_branch: 'alone_and_report',
  clear_halt: 'owner',
  reset_counters: 'owner',
  close_issues: 'owner',
  delete_unmerged_branch: 'owner',
  touch_production: 'owner',
  publish_outside_repository: 'owner',
  change_principle: 'owner',
  change_approval_table: 'owner',
  change_blocking_check: 'owner',
  raise_budget: 'never',
} as const satisfies Record<string, Authority>;

export type ApprovalAction = keyof typeof APPROVAL_POLICY;

/** An action the table does not list needs the owner. */
export function approvalFor(action: string): Authority {
  return Object.hasOwn(APPROVAL_POLICY, action) ? APPROVAL_POLICY[action as ApprovalAction] : 'owner';
}

export interface OwnerItem {
  question: string;
  recommendation: string;
  because: string;
}

export interface ReportInputs {
  /** The measures the owner sees; absent leaves the section out. */
  measures?: Measures;
  status: StatusReport;
  plan: OrientPlan;
  branch: string;
  baseBranch: string;
  /** Tickets whose verification ran out of rounds. */
  handedOver?: HandedOver[];
  /** Issues and proposed ADRs that wait on the owner's decision. */
  ownerWaiting?: OwnerItem[];
  /** What merged in the period; absent when the tracker could not be read. */
  merged?: string[];
  period?: Period;
}

export interface Report {
  /** The period the merges and measures cover. */
  period: Period;
  /** Merges inside the period; null when the tracker could not be read. */
  merged: string[] | null;
  in_progress: Array<{ticket: string; branch: string}>;
  declined: Array<{ticket: string; reason: string}>;
  handed_over: Array<{ticket: string; pr: number; criteria: string[]}>;
  next: string[];
  waiting_on_owner: OwnerItem[];
  measures: ReportMeasures | null;
}

export function buildReport(i: ReportInputs): Report {
  const {status: s, plan} = i;
  const waiting: OwnerItem[] = [];
  if (plan.action === 'surface_halt') {
    waiting.push({
      question: `The loop is halted: ${plan.reason}`,
      recommendation: 'check for a pushed branch with no merged PR, finish or discard it, then resume',
      because: 'clearing a halt blindly can march the loop past unmerged work',
    });
  }
  for (const a of plan.anomalies) {
    waiting.push({
      question: `Something looks wrong: ${a}`,
      recommendation: 'look at the branch and the lock before starting or stopping anything',
      because: 'a runner built on the wrong base wastes a whole ticket',
    });
  }
  waiting.push(...(i.ownerWaiting ?? []));
  const inProgress = s.current_ticket && s.runner.alive ? [{ticket: s.current_ticket, branch: i.branch}] : [];
  return {
    period: i.period ?? {since: null, source: 'none'},
    merged: i.merged ?? null,
    in_progress: inProgress,
    declined: s.declined,
    handed_over: (i.handedOver ?? []).map(h => ({
      ticket: h.ticket,
      pr: h.pr,
      criteria: h.open.map(o => `${o.criterion} ${o.verdict}`),
    })),
    next: s.next_pick ? [s.next_pick] : [],
    waiting_on_owner: waiting,
    measures: i.measures === undefined ? null : buildReportMeasures(i.measures),
  };
}

export function formatReport(r: Report): string {
  const list = (items: string[]): string[] => (items.length ? items.map(t => `- ${t}`) : ['- none']);
  return [
    `**Merged** ${r.period.since === null ? '(whole history)' : `(since ${r.period.since})`}`,
    ...(r.merged === null ? ['- unknown: the merged pull requests could not be read'] : list(r.merged)),
    '',
    '**In progress**',
    ...list(r.in_progress.map(p => `${p.ticket} on branch \`${p.branch || 'detached'}\``)),
    '',
    '**Declined**',
    ...list(r.declined.map(d => `${d.ticket} (${d.reason})`)),
    '',
    '**Handed over**',
    ...list(r.handed_over.map(h => `${h.ticket} (PR #${h.pr}): ${h.criteria.join(', ')}`)),
    '',
    '**Next**',
    ...list(r.next),
    '',
    '**Waiting on you**',
    ...list(r.waiting_on_owner.map(o => `${o.question} - I recommend ${o.recommendation}, because ${o.because}.`)),
    ...(r.measures === null ? [] : ['', '**Measures**', ...formatReportMeasures(r.measures)]),
  ].join('\n');
}
