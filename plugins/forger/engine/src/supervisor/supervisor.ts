/**
 * The supervisor's decisions, as pure functions over facts a tool gathered:
 * what to do on arrival, what needs the owner, and the report. The command
 * (`commands/work.md`) calls these through the CLI and keeps only judgement.
 */

import {conflictAnswer, behindBaseAnomaly, dirtyCheckoutAnomaly, type BaseSync, missingVerifyStatusAnomaly, type LeaseView, openLabel, recommendationFor, type HandedOver, type StatusReport} from '../loop';
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
  /** What blocks each remaining ticket, one line per ticket; undefined when not read. */
  blockers?: string[];
  /** Whether the base branch requires the `forger/verify` check; undefined or null when not known. */
  requiresVerify?: boolean | null;
  /** The stored lease seen from this machine; undefined when not read. */
  lease?: LeaseView;
  /** Why the hooks gate fails, with the fix; undefined or null when it passes or was not read. */
  hooksGate?: string | null;
  /** The base branch against its remote; undefined when not read. */
  baseSync?: BaseSync;
}

export interface OrientPlan {
  action: OrientAction;
  /** Why, in a sentence the report can quote. */
  reason: string;
  /** Facts that look wrong and deserve a line in the report. */
  anomalies: string[];
  /** For nothing_to_do with tickets left: what blocks each of them. */
  blockers: string[];
  /** The stored lease seen from this machine: holder, host and expiry; null when not read. */
  lease: LeaseView | null;
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
  const lease = i.lease;
  if (lease?.state === 'stale_local') {
    anomalies.push(`the lease names ${lease.holder}, a dead engine on this machine; the next start takes it over`);
  }
  for (const label of i.missingLabels ?? []) {
    anomalies.push(`the label "${label}" the loop relies on does not exist on GitHub; run setup to create it`);
  }
  const behind = behindBaseAnomaly(i.baseSync, i.baseBranch, s.runner.alive);
  if (behind) anomalies.push(behind);
  const dirty = dirtyCheckoutAnomaly(i.baseSync, s.runner.alive);
  if (dirty) anomalies.push(dirty);
  if (i.requiresVerify === false) anomalies.push(missingVerifyStatusAnomaly(i.baseBranch));
  if (i.hooksGate) anomalies.push(i.hooksGate);
  anomalies.push(...(i.backlogAnomalies ?? []));
  if (s.halted) {
    return {action: 'surface_halt', reason: i.haltReason?.trim() || s.last_error || 'halted, no reason recorded', anomalies, blockers: [], lease: i.lease ?? null};
  }
  if (s.runner.alive) {
    return {action: 'attach', reason: `a runner is alive (pid ${s.runner.pid})`, anomalies, blockers: [], lease: i.lease ?? null};
  }
  if (lease?.state === 'live_elsewhere') {
    return {action: 'nothing_to_do', reason: `another machine (${lease.host}) holds the loop lease (${lease.holder}) until ${lease.expires_at}; an engine started here is refused`, anomalies, blockers: [], lease: i.lease ?? null};
  }
  if (s.remaining === 0) {
    return {action: 'nothing_to_do', reason: 'the backlog has nothing left; plan the next work', anomalies, blockers: [], lease: i.lease ?? null};
  }
  if (s.workable === 0) {
    const blockers = i.blockers ?? [];
    return {
      action: 'nothing_to_do',
      reason: `${s.remaining} ticket(s) remain but none is workable; they wait on the owner`,
      anomalies,
      blockers,
      lease: i.lease ?? null,
    };
  }
  return {action: 'start', reason: `${s.remaining} ticket(s) remain and no runner is alive`, anomalies, blockers: [], lease: i.lease ?? null};
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
  resume_after_known_recovery: 'alone_and_report',
  file_critique_tickets: 'alone_and_report',
  clear_halt: 'owner',
  reset_counters: 'owner',
  close_issues: 'owner',
  delete_unmerged_branch: 'owner',
  touch_production: 'owner',
  publish_outside_repository: 'owner',
  change_principle: 'owner',
  change_approval_table: 'owner',
  change_blocking_check: 'owner',
  ui_approve: 'owner',
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
  /** The kind of the halt standing, when known; picks the recommended action. */
  haltKind?: string | null;
  /** Halts the engine recovered by itself, one line each. */
  recovered?: string[];
  /** Gates that failed and passed on a rerun with no change, one line each. */
  flakyGates?: string[];
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
  recovered: string[];
  flaky_gates: string[];
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
      recommendation: conflictAnswer(plan.reason) ?? recommendationFor(i.haltKind ?? null),
      because: 'clearing a halt blindly can march the loop past unmerged work',
    });
  }
  for (const b of plan.blockers) {
    waiting.push({
      question: `Nothing is workable: ${b}`,
      recommendation: 'unblock the dependency, or take the ticket off the loop',
      because: 'the loop has stopped without a halt and starts by itself once something is workable',
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
    recovered: i.recovered ?? [],
    flaky_gates: i.flakyGates ?? [],
    handed_over: (i.handedOver ?? []).map(h => ({
      ticket: h.ticket,
      pr: h.pr,
      criteria: h.open.map(openLabel),
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
    '**Recovered by the engine**',
    ...list(r.recovered),
    '',
    '**Flaky gates**',
    ...list(r.flaky_gates),
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
