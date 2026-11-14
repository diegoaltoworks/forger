/**
 * The measures the refinement loop runs on, computed from facts the engine
 * already leaves behind: the per-iteration logs, the work log, the terminal
 * events and CI's run list. Pure; the CLI gathers the inputs.
 */

import {formatHaltClears, haltClearCounts, type HaltClearCounts, type ScheduleRecord, type TerminalEvent, type VerdictRecord} from '../loop';
import {formatStoredPlan, parsePlanLine, type StoredPlan} from '../pipeline';
import {computeRework, formatRework, type ReworkInputs, type ReworkMeasures} from './rework';
import {computeJourneyShare, formatJourneyShare, type JourneyPaths, type JourneyShare} from './journey-share';
import {computeParallelMeasures, type ParallelMeasures} from './parallel-measures';

export type Cause = 'ok' | 'timeout' | 'signal' | 'nonzero_exit' | 'unreadable';

export interface IterationRecord {
  iteration: number;
  ticket: string | null;
  elapsedSeconds: number;
  cause: Cause;
  /** The decided outcome status; null in a log written before it was recorded. */
  status: string | null;
  startedAt?: string | null;
  parallelism?: number | null;
  /** The pipeline plan the run started with; absent in a log written before plans were kept. */
  plan?: StoredPlan;
}

export interface BudgetRecord {
  ticket: string;
  model: string;
  budgetUsd: number;
  /** The worker's session id, when the work log recorded it. */
  sessionId?: string;
}

export interface CiRun {
  headBranch: string;
  event: string;
}

export interface TicketMeasure {
  ticket: string;
  runs: number;
  seconds: number;
  budget_cap_usd: number | null;
  /** What the ticket's sessions spent, from their transcripts; null unless every session has a known cost. */
  cost_usd: number | null;
  ci_rounds: number | null;
  /** The pipeline plan of the ticket's latest run that recorded one. */
  plan?: StoredPlan;
}

export interface Measures {
  window: {last: number | null; iterations: number};
  runs: {total: number; ok: number; failed: number; by_cause: Record<string, number>};
  /** Share of runs in the window by how they related to the engine's pick; 0 when there are no runs. */
  pick: {off_pick: number; off_pick_share: number; declined: number; declined_share: number};
  /** How the verifier's verdicts held up (ADR 0010), over the tickets in the window. */
  verification: {
    verified: number;
    blocked: number;
    blocked_share: number;
    passed: number;
    passed_then_failed: number;
    passed_then_failed_share: number;
  };
  /** What workers side by side bought and cost (ADR 0011). */
  parallel: ParallelMeasures;
  /** Tickets with at least one run that merged, over the window. */
  merged: {tickets: number};
  /** Work done twice: a ticket that merged more than once, or failed after it merged. */
  rework: {redone_tickets: number};
  /** Events that stop the loop until a person acts (ADR 0012). */
  owner_interventions: {total: number; by_event: Record<string, number>};
  /** Why the count above cannot be trusted (events missing for runs in the window); null when it can. */
  interventions_unknown: string | null;
  /** How cleared halts were explained: with a cause, as not a defect, or with no reason (ADR 0012). */
  halt_clears: HaltClearCounts;
  /** Rework and escaped defects over merged PRs (ADR 0013); null when the tracker could not be read. */
  change_rework: ReworkMeasures | null;
  /** Merged PRs that changed a journey against upkeep; null without a journeys file or a readable tracker. */
  journeys: JourneyShare | null;
  events: Record<string, number>;
  tickets: TicketMeasure[];
  ci_rounds_unmatched: Record<string, number>;
  /** Inputs that live only on the engine's machine and were not found here; their measures read as unknown. */
  not_on_this_machine?: string[];
}

/** Reads one `iteration-N.log`; null when the header is not forger's. */
export function parseIterationLog(text: string): IterationRecord | null {
  const head = /^=== forger iteration (\d+) ===$/m.exec(text);
  if (!head) return null;
  const field = (name: string) => new RegExp(`^${name}: (.*)$`, 'm').exec(text)?.[1] ?? null;
  const ticket = field('ticket');
  const elapsed = field('elapsed');
  const outcome = field('outcome');
  let cause: Cause = 'unreadable';
  if (outcome !== null) {
    if (outcome.startsWith('timed out')) cause = 'timeout';
    else if (outcome.startsWith('ended by')) cause = 'signal';
    else if (outcome === 'exited with code 0') cause = 'ok';
    else if (outcome.startsWith('exited with code')) cause = 'nonzero_exit';
  }
  const plan = parsePlanLine(field('plan'));
  return {
    ...(plan ? {plan} : {}),
    iteration: Number(head[1]),
    ticket: ticket === null || ticket === 'none picked' ? null : ticket,
    elapsedSeconds: elapsed === null ? 0 : parseInt(elapsed, 10) || 0,
    cause,
    status: field('status'),
    startedAt: field('started'),
    parallelism: field('parallelism') === null ? null : parseInt(field('parallelism') as string, 10) || null,
  };
}

/**
 * The `Ticket: <id> [<model>, $<cap>]` lines of the work log, in order. The
 * session is the full id the line carries, or else the shortened id of the
 * `(session: <prefix>...)` line just before it, which older logs wrote alone.
 */
export function parseBudgets(workLog: string): BudgetRecord[] {
  const out: BudgetRecord[] = [];
  let prefix: string | undefined;
  for (const line of workLog.split('\n')) {
    const s = /\(session: ([0-9a-f-]+)(?:\.\.\.)?\)/.exec(line);
    if (s !== null) {
      prefix = s[1];
      continue;
    }
    const m = /Ticket: (\S+) \[([^,\]]+), \$([0-9.]+)\](?: session ([0-9a-f-]+))?/.exec(line);
    if (m === null) continue;
    const sessionId = m[4] ?? prefix;
    out.push({ticket: m[1], model: m[2], budgetUsd: Number(m[3]), ...(sessionId === undefined ? {} : {sessionId})});
    prefix = undefined;
  }
  return out;
}

/**
 * The ticket id a head branch builds. A GitHub ticket keeps its hyphen
 * (`feat/issue-72` -> `issue-72`); a legacy ticket id uses underscores
 * (`feat/some-ticket` -> `some_ticket`).
 */
export function branchTicketId(branch: string): string {
  const name = branch.replace(/^[a-z]+\//, '');
  return /^issue-\d+$/.test(name) ? name : name.replace(/-/g, '_');
}

/** Pull-request runs per head branch: each push a ticket needed is one round. */
export function ciRoundsByBranch(runs: CiRun[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of runs) {
    if (r.event !== 'pull_request') continue;
    out[r.headBranch] = (out[r.headBranch] ?? 0) + 1;
  }
  return out;
}

export interface MeasureInputs {
  iterations: IterationRecord[];
  budgets: BudgetRecord[];
  events: TerminalEvent[];
  /** Every record in the events file, of any kind; a run with one of them is covered. Absent: `events` decides. */
  records?: {iteration: number}[];
  /** The `halt_cleared` events; absent reads as none. */
  clears?: TerminalEvent[];
  ciRuns: CiRun[];
  /** Session id -> cost in dollars, null when its transcript is missing; absent reads as none known. */
  sessionCosts?: Record<string, number | null>;
  /** The verdict records `verify` left; absent reads as none. */
  verdicts?: VerdictRecord[];
  /** The scheduling decisions the parallel loop left; absent reads as none. */
  schedule?: ScheduleRecord[];
  /** Merged PRs, issues and picks for rework and escaped defects; absent reads as none gathered. */
  changes?: ReworkInputs;
  /** The journeys of `.forger/journeys.json`; absent when the project has none. */
  journeys?: JourneyPaths[];
  /** Only the most recent N iterations; null = all. */
  last: number | null;
}

/** Statuses of a run that failed after its PR was verified. */
const LATER_FAILURES: readonly string[] = ['merged-red', 'failed', 'error'];

/**
 * A PR counts once however many rounds it took. `blocked`: some round did not
 * pass. `passed_then_failed`: a round passed and a run of that ticket then
 * ended in a failure status.
 */
export function verificationMeasures(verdicts: VerdictRecord[], iterations: IterationRecord[]): Measures['verification'] {
  const tickets = new Set(iterations.flatMap(it => (it.ticket === null ? [] : [it.ticket])));
  const failedTickets = new Set(iterations.filter(it => it.ticket !== null && it.status !== null && LATER_FAILURES.includes(it.status)).map(it => it.ticket));
  const byPr = new Map<number, VerdictRecord[]>();
  for (const r of verdicts) {
    if (!tickets.has(r.ticket)) continue;
    byPr.set(r.pr, [...(byPr.get(r.pr) ?? []), r]);
  }
  let blocked = 0;
  let passed = 0;
  let passedThenFailed = 0;
  for (const records of byPr.values()) {
    if (records.some(r => r.decision !== 'pass')) blocked += 1;
    if (records.some(r => r.decision === 'pass')) {
      passed += 1;
      if (failedTickets.has(records[0].ticket)) passedThenFailed += 1;
    }
  }
  const verified = byPr.size;
  return {
    verified,
    blocked,
    blocked_share: verified === 0 ? 0 : blocked / verified,
    passed,
    passed_then_failed: passedThenFailed,
    passed_then_failed_share: passed === 0 ? 0 : passedThenFailed / passed,
  };
}

/** Terminal events after which only a person can restart or settle the work. */
export const INTERVENTION_EVENTS: readonly string[] = ['halted', 'too_many_failures', 'merged_red', 'unverified'];

/** Tickets that merged more than once, or ran again to a failure after a merge. */
export function reworkMeasures(iterations: IterationRecord[]): {merged: number; redone: number} {
  const ordered = [...iterations].sort((a, b) => a.iteration - b.iteration);
  const merges = new Map<string, number>();
  const redone = new Set<string>();
  for (const it of ordered) {
    if (it.ticket === null) continue;
    if (it.status === 'completed') {
      if ((merges.get(it.ticket) ?? 0) > 0) redone.add(it.ticket);
      merges.set(it.ticket, (merges.get(it.ticket) ?? 0) + 1);
    } else if (it.status !== null && LATER_FAILURES.includes(it.status) && (merges.get(it.ticket) ?? 0) > 0) {
      redone.add(it.ticket);
    }
  }
  return {merged: merges.size, redone: redone.size};
}

/** Sum of a ticket's session costs; null unless it has sessions and every one has a known cost. */
export function ticketCost(records: BudgetRecord[], costs: Record<string, number | null>): number | null {
  if (records.length === 0) return null;
  let total = 0;
  for (const r of records) {
    const c = r.sessionId === undefined ? null : costs[r.sessionId] ?? null;
    if (c === null) return null;
    total += c;
  }
  return total;
}

/**
 * Why interventions cannot be counted: a run in the window with no event at
 * all means the events file did not cover it, so a zero would be a guess.
 */
export function eventsGap(windowed: IterationRecord[], events: {iteration: number}[]): string | null {
  const seen = new Set(events.map(e => e.iteration));
  const missing = new Set(windowed.filter(it => !seen.has(it.iteration)).map(it => it.iteration));
  if (missing.size === 0) return null;
  return `the events file has no record of ${missing.size} of ${windowed.length} run(s) in the period`;
}

export function computeMeasures(inputs: MeasureInputs): Measures {
  const sorted = [...inputs.iterations].sort((a, b) => a.iteration - b.iteration);
  const windowed = inputs.last === null ? sorted : sorted.slice(-Math.max(inputs.last, 0));
  const first = windowed[0]?.iteration ?? null;
  const decisions = inputs.schedule ?? [];
  const starts = windowed.flatMap(it => (it.startedAt == null ? [] : [it.startedAt])).sort();
  const windowStart = inputs.last === null || starts.length === 0 ? null : starts[0];

  const byCause: Record<string, number> = {};
  for (const it of windowed) if (it.cause !== 'ok') byCause[it.cause] = (byCause[it.cause] ?? 0) + 1;
  const failed = Object.values(byCause).reduce((a, b) => a + b, 0);

  const offPick = windowed.filter(it => it.status === 'off-pick').length;
  const declinedRuns = windowed.filter(it => it.status === 'declined').length;
  const share = (n: number) => (windowed.length === 0 ? 0 : n / windowed.length);

  const events: Record<string, number> = {};
  for (const e of inputs.events) {
    if (first !== null && e.iteration < first) continue;
    events[e.event] = (events[e.event] ?? 0) + 1;
  }

  const interventions: Record<string, number> = {};
  for (const [name, n] of Object.entries(events)) if (INTERVENTION_EVENTS.includes(name)) interventions[name] = n;
  const rework = reworkMeasures(windowed);

  const rounds = ciRoundsByBranch(inputs.ciRuns);
  const byTicket = new Map<string, string>();
  for (const branch of Object.keys(rounds)) byTicket.set(branchTicketId(branch), branch);
  const matched = new Set<string>();

  const perTicket = new Map<string, TicketMeasure>();
  for (const it of windowed) {
    if (it.ticket === null) continue;
    const t = perTicket.get(it.ticket) ?? {ticket: it.ticket, runs: 0, seconds: 0, budget_cap_usd: null, cost_usd: null, ci_rounds: null};
    t.runs += 1;
    t.seconds += it.elapsedSeconds;
    if (it.plan) t.plan = it.plan;
    perTicket.set(it.ticket, t);
  }
  for (const t of perTicket.values()) {
    const caps = inputs.budgets.filter(b => b.ticket === t.ticket);
    if (caps.length > 0) t.budget_cap_usd = caps.reduce((a, b) => a + b.budgetUsd, 0);
    t.cost_usd = ticketCost(caps, inputs.sessionCosts ?? {});
    const branch = byTicket.get(t.ticket);
    if (branch !== undefined) {
      t.ci_rounds = rounds[branch];
      matched.add(branch);
    }
  }
  const unmatched: Record<string, number> = {};
  for (const [branch, n] of Object.entries(rounds)) if (!matched.has(branch)) unmatched[branch] = n;

  return {
    window: {last: inputs.last, iterations: windowed.length},
    runs: {total: windowed.length, ok: windowed.length - failed, failed, by_cause: byCause},
    pick: {off_pick: offPick, off_pick_share: share(offPick), declined: declinedRuns, declined_share: share(declinedRuns)},
    verification: verificationMeasures(inputs.verdicts ?? [], windowed),
    parallel: computeParallelMeasures(windowed.map(it => ({...it, startedAt: it.startedAt ?? null, parallelism: it.parallelism ?? null})), windowStart === null ? decisions : decisions.filter(d => d.at >= windowStart)),
    merged: {tickets: rework.merged},
    rework: {redone_tickets: rework.redone},
    owner_interventions: {total: Object.values(interventions).reduce((a, b) => a + b, 0), by_event: interventions},
    interventions_unknown: eventsGap(windowed, inputs.records ?? inputs.events),
    halt_clears: haltClearCounts((inputs.clears ?? []).filter(e => first === null || e.iteration >= first)),
    change_rework: inputs.changes === undefined ? null : computeRework(inputs.changes),
    journeys: inputs.journeys === undefined || inputs.changes === undefined ? null : computeJourneyShare(inputs.changes.prs.map(p => ({number: p.number, files: [...new Set([...p.ranges, ...(p.replaced ?? [])].map(r => r.file))]})), inputs.journeys),
    events,
    tickets: [...perTicket.values()],
    ci_rounds_unmatched: unmatched,
  };
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function formatParallel(p: Measures['parallel']): string[] {
  const rates = p.by_parallelism.map(r => `parallelism ${r.parallelism}: ${r.merges_per_hour.toFixed(2)}/h (${r.merges} merged)`).join(', ');
  const reasons = Object.entries(p.verdicts.by_reason).map(([k, v]) => `${k} ${v}`).join(', ');
  return [
    `merges per hour: ${rates || 'none'}`,
    `conflicts: ${p.conflicts.conflicted} (${pct(p.conflicts.rate)}), pairs ${p.conflicts.pairs.map(x => x.join('+')).join(', ') || 'none'}, re-run after conflict ${p.rework.rerun_after_conflict}`,
    `scheduling rule: serial ${pct(p.verdicts.serial_share)} (${p.verdicts.serial} of ${p.verdicts.parallel + p.verdicts.serial})${reasons ? `: ${reasons}` : ''}`,
  ];
}

export function formatMeasures(m: Measures): string {
  const causes = Object.entries(m.runs.by_cause).map(([k, v]) => `${k} ${v}`).join(', ');
  const lines = [
    `runs: ${m.runs.total} (ok ${m.runs.ok}, failed ${m.runs.failed}${causes ? `: ${causes}` : ''})`,
    `pick: off-pick ${pct(m.pick.off_pick_share)} (${m.pick.off_pick}), declined ${pct(m.pick.declined_share)} (${m.pick.declined})`,
    `verification: blocked ${pct(m.verification.blocked_share)} (${m.verification.blocked} of ${m.verification.verified}), passed then failed ${pct(m.verification.passed_then_failed_share)} (${m.verification.passed_then_failed} of ${m.verification.passed})`,
    ...formatParallel(m.parallel),
    `merged tickets: ${m.merged.tickets}, redone ${m.rework.redone_tickets}, owner interventions ${m.interventions_unknown === null ? m.owner_interventions.total : `unknown (${m.interventions_unknown})`}`,
    ...formatHaltClears(m.halt_clears),
    ...(m.change_rework === null ? ['rework and escaped defects: unknown'] : formatRework(m.change_rework)),
    ...(m.journeys === null ? [] : [formatJourneyShare(m.journeys)]),
    `events: ${Object.entries(m.events).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    ...(m.not_on_this_machine?.length ? [`not on this machine: ${m.not_on_this_machine.join(', ')}`] : []),
    'tickets:',
    ...m.tickets.map(
      t =>
        `  ${t.ticket}: ${t.runs} run(s), ${t.seconds}s, cap ${t.budget_cap_usd === null ? 'unknown' : `$${t.budget_cap_usd}`}, cost ${t.cost_usd === null ? 'unknown' : `$${t.cost_usd.toFixed(2)}`}, CI rounds ${t.ci_rounds ?? 'unknown'}`
    ).flatMap((line, i) => [line, ...formatStoredPlan(m.tickets[i].plan).map(p => `    plan ${p}`)]),
  ];
  return lines.join('\n');
}

export interface RuleRecord {
  name: string;
  description: string;
  type: 'feedback' | 'project' | 'user' | 'reference';
  rule: string;
  /** The owner's words, verbatim. */
  ownerWords: string;
  date: string;
  why: string;
  howToApply: string;
  enforcedBy: string;
}

const RULE_TYPES = ['feedback', 'project', 'user', 'reference'];

/** Why a rule record cannot be written, or null. */
export function ruleProblem(r: RuleRecord): string | null {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.name)) return 'name must be a kebab-case slug';
  if (!RULE_TYPES.includes(r.type)) return `type must be one of ${RULE_TYPES.join(', ')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return 'date must be YYYY-MM-DD';
  for (const k of ['description', 'rule', 'ownerWords', 'why', 'howToApply'] as const) {
    if (r[k].trim() === '') return `${k} is required`;
  }
  return null;
}

export function ruleFilePath(name: string): string {
  return `.forger/rules/${name}.md`;
}

/** The record in the shape of templates/rule.md. */
export function renderRule(r: RuleRecord): string {
  return [
    '---',
    `name: ${r.name}`,
    `description: ${r.description}`,
    `type: ${r.type}`,
    '---',
    '',
    r.rule,
    '',
    `Owner (${r.date}): "${r.ownerWords}"`,
    '',
    `**Why:** ${r.why}`,
    '',
    `**How to apply:** ${r.howToApply}`,
    '',
    `**Enforced by:** ${r.enforcedBy.trim() === '' ? 'nothing yet' : r.enforcedBy}`,
    '',
  ].join('\n');
}

export interface UpstreamLesson {
  title: string;
  lesson: string;
  evidence: string[];
}

/** An issue draft for forger itself; a lesson without evidence is not filed. */
export function draftUpstreamIssue(l: UpstreamLesson): {title: string; body: string} {
  if (l.evidence.length === 0) throw new Error('an upstream lesson needs evidence');
  if (l.title.trim() === '' || l.lesson.trim() === '') throw new Error('an upstream lesson needs a title and a lesson');
  return {
    title: l.title.trim(),
    body: [
      '## Lesson',
      '',
      l.lesson.trim(),
      '',
      '## Evidence',
      '',
      ...l.evidence.map(e => `- ${e}`),
      '',
      'Raised from a project retro; the lesson holds beyond that project.',
      '',
    ].join('\n'),
  };
}
