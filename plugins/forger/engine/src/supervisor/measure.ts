/**
 * The measures the refinement loop runs on, computed from facts the engine
 * already leaves behind: the per-iteration logs, the work log, the terminal
 * events and CI's run list. Pure; the CLI gathers the inputs.
 */

import type {TerminalEvent} from '../loop';

export type Cause = 'ok' | 'timeout' | 'signal' | 'nonzero_exit' | 'unreadable';

export interface IterationRecord {
  iteration: number;
  ticket: string | null;
  elapsedSeconds: number;
  cause: Cause;
}

export interface BudgetRecord {
  ticket: string;
  model: string;
  budgetUsd: number;
}

export interface CiRun {
  headBranch: string;
  event: string;
}

export interface TicketMeasure {
  ticket: string;
  runs: number;
  seconds: number;
  budget_usd: number | null;
  ci_rounds: number | null;
}

export interface Measures {
  window: {last: number | null; iterations: number};
  runs: {total: number; ok: number; failed: number; by_cause: Record<string, number>};
  events: Record<string, number>;
  tickets: TicketMeasure[];
  ci_rounds_unmatched: Record<string, number>;
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
  return {
    iteration: Number(head[1]),
    ticket: ticket === null || ticket === 'none picked' ? null : ticket,
    elapsedSeconds: elapsed === null ? 0 : parseInt(elapsed, 10) || 0,
    cause,
  };
}

/** The `Ticket: <id> [<model>, $<cap>]` lines of the work log, in order. */
export function parseBudgets(workLog: string): BudgetRecord[] {
  const out: BudgetRecord[] = [];
  for (const m of workLog.matchAll(/Ticket: (\S+) \[([^,\]]+), \$([0-9.]+)\]/g)) {
    out.push({ticket: m[1], model: m[2], budgetUsd: Number(m[3])});
  }
  return out;
}

/** `feat/some-ticket-id` and `some_ticket_id` name the same ticket. */
export function normalizeBranch(branch: string): string {
  return branch.replace(/^[a-z]+\//, '').replace(/-/g, '_');
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
  ciRuns: CiRun[];
  /** Only the most recent N iterations; null = all. */
  last: number | null;
}

export function computeMeasures(inputs: MeasureInputs): Measures {
  const sorted = [...inputs.iterations].sort((a, b) => a.iteration - b.iteration);
  const windowed = inputs.last === null ? sorted : sorted.slice(-Math.max(inputs.last, 0));
  const first = windowed[0]?.iteration ?? null;

  const byCause: Record<string, number> = {};
  for (const it of windowed) if (it.cause !== 'ok') byCause[it.cause] = (byCause[it.cause] ?? 0) + 1;
  const failed = Object.values(byCause).reduce((a, b) => a + b, 0);

  const events: Record<string, number> = {};
  for (const e of inputs.events) {
    if (first !== null && e.iteration < first) continue;
    events[e.event] = (events[e.event] ?? 0) + 1;
  }

  const rounds = ciRoundsByBranch(inputs.ciRuns);
  const byNormalized = new Map<string, string>();
  for (const branch of Object.keys(rounds)) byNormalized.set(normalizeBranch(branch), branch);
  const matched = new Set<string>();

  const perTicket = new Map<string, TicketMeasure>();
  for (const it of windowed) {
    if (it.ticket === null) continue;
    const t = perTicket.get(it.ticket) ?? {ticket: it.ticket, runs: 0, seconds: 0, budget_usd: null, ci_rounds: null};
    t.runs += 1;
    t.seconds += it.elapsedSeconds;
    perTicket.set(it.ticket, t);
  }
  for (const t of perTicket.values()) {
    const caps = inputs.budgets.filter(b => b.ticket === t.ticket);
    if (caps.length > 0) t.budget_usd = caps.reduce((a, b) => a + b.budgetUsd, 0);
    const branch = byNormalized.get(t.ticket);
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
    events,
    tickets: [...perTicket.values()],
    ci_rounds_unmatched: unmatched,
  };
}

export function formatMeasures(m: Measures): string {
  const causes = Object.entries(m.runs.by_cause).map(([k, v]) => `${k} ${v}`).join(', ');
  const lines = [
    `runs: ${m.runs.total} (ok ${m.runs.ok}, failed ${m.runs.failed}${causes ? `: ${causes}` : ''})`,
    `events: ${Object.entries(m.events).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    'tickets:',
    ...m.tickets.map(
      t =>
        `  ${t.ticket}: ${t.runs} run(s), ${t.seconds}s, cap ${t.budget_usd === null ? 'unknown' : `$${t.budget_usd}`}, CI rounds ${t.ci_rounds ?? 'unknown'}`
    ),
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
