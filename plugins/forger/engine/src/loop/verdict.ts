/**
 * The verifier's verdict (ADR 0010) as a pure, checked record: the acceptance
 * criteria parsed from the issue, a validator that holds a verdict to them, and
 * the reducer that turns it into the one answer `merge` acts on. No I/O: whether
 * an evidence reference resolves is decided by a predicate the caller passes in.
 */

export type Judgement = 'met' | 'not_met' | 'cannot_tell';
export type Decision = 'pass' | 'block' | 'unclear';
export type EvidenceKind = 'file' | 'command' | 'test' | 'check' | 'screenshot';

/** What a `cannot_tell` lacked: the owner acts on this, so it is a fixed list and not prose. */
export const MISSING = ['no_state', 'no_test', 'no_data', 'infra', 'ambiguous_criterion'] as const;
export type Missing = (typeof MISSING)[number];

export interface Evidence {
  kind: EvidenceKind;
  /** A file with line, a command, a test name, or (kind screenshot) a path under docs/screenshots/. */
  ref: string;
}

export interface Criterion {
  id: string;
  text: string;
  /** A UI state the ticket names: `met` needs a screenshot that shows it. */
  ui?: boolean;
}

export interface VerdictEntry {
  criterion: string;
  verdict: Judgement;
  evidence: Evidence[];
  /** Required on `cannot_tell`: the capability the verifier lacked. */
  missing?: Missing;
}

export interface CheckedEntry extends VerdictEntry {
  /** Set when the validator changed the verdict, and why. */
  demoted?: string;
}

export interface VerdictCheck {
  /** Reasons the verdict is rejected; empty when it is acceptable. */
  problems: string[];
  /** The entries after demotion, in the ticket's criterion order where present. */
  entries: CheckedEntry[];
}

const CHECKBOX = /^\s*[-*]\s+\[[ xX]\]\s+(.+?)\s*$/;
const HEADING = /^#{1,6}\s+(.*?)\s*$/;

/**
 * The criteria are the checkbox items of the issue's Acceptance section; an issue
 * with no such heading falls back to every checkbox in the body.
 */
export function parseCriteria(body: string): Criterion[] {
  const lines = body.split(/\r?\n/);
  const all: string[] = [];
  const inSection: string[] = [];
  let hasSection = false;
  let inAcceptance = false;
  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading) {
      inAcceptance = /^acceptance\b/i.test(heading[1]);
      if (inAcceptance) hasSection = true;
      continue;
    }
    const item = CHECKBOX.exec(line);
    if (!item) continue;
    all.push(item[1]);
    if (inAcceptance) inSection.push(item[1]);
  }
  return (hasSection ? inSection : all).map((text, i) => ({id: `c${i + 1}`, text}));
}

const BULLET = /^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/;

/** The bullets of the issue's "UI states" section as criteria `u1`, `u2`...; "none" names no state. */
export function parseUiStates(body: string): Criterion[] {
  const texts: string[] = [];
  let inSection = false;
  for (const line of body.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading) {
      inSection = /^ui states\b/i.test(heading[1]);
      continue;
    }
    const item = inSection ? BULLET.exec(line) : null;
    if (item && !/^none\.?$/i.test(item[1])) texts.push(item[1]);
  }
  return texts.map((text, i) => ({id: `u${i + 1}`, text, ui: true}));
}

/** What `demoted` starts with when a `met` fell because its evidence did not check out; the cue for a second round. */
export const EVIDENCE_DEMOTION = 'evidence does not check out: ';

const JUDGEMENTS: readonly Judgement[] = ['met', 'not_met', 'cannot_tell'];

/** Hold a verdict to the ticket's criteria. `resolves` says whether one piece of evidence points at something real. */
export function checkVerdict(
  criteria: Criterion[],
  verdict: VerdictEntry[],
  resolves: (evidence: Evidence) => boolean,
): VerdictCheck {
  const problems: string[] = [];
  const known = new Set(criteria.map(c => c.id));
  const seen = new Set<string>();
  const entries: CheckedEntry[] = [];

  for (const entry of verdict) {
    if (!known.has(entry.criterion)) {
      problems.push(`extra criterion ${entry.criterion}: the ticket has no such criterion`);
      continue;
    }
    if (seen.has(entry.criterion)) {
      problems.push(`criterion ${entry.criterion} is judged more than once`);
      continue;
    }
    seen.add(entry.criterion);
    if (!JUDGEMENTS.includes(entry.verdict)) {
      problems.push(`criterion ${entry.criterion} has an unknown verdict "${entry.verdict}"`);
      continue;
    }
    entries.push(settle(entry, criteria.find(c => c.id === entry.criterion)?.ui === true, resolves, problems));
  }

  for (const c of criteria) {
    if (!seen.has(c.id)) problems.push(`missing criterion ${c.id}: ${c.text}`);
  }

  const order = new Map(criteria.map((c, i) => [c.id, i]));
  entries.sort((a, b) => (order.get(a.criterion) ?? 0) - (order.get(b.criterion) ?? 0));
  return {problems, entries};
}

function settle(entry: VerdictEntry, ui: boolean, resolves: (e: Evidence) => boolean, problems: string[]): CheckedEntry {
  if (entry.verdict === 'cannot_tell') {
    if (!MISSING.includes(entry.missing as Missing)) {
      problems.push(`criterion ${entry.criterion} is cannot_tell without "missing", one of ${MISSING.join(', ')}`);
    }
    return {...entry};
  }
  const evidence = entry.evidence ?? [];
  if (evidence.length === 0) {
    problems.push(`criterion ${entry.criterion} is ${entry.verdict} without evidence`);
    return {...entry};
  }
  if (ui && entry.verdict === 'met' && !evidence.some(e => e.kind === 'screenshot' && resolves(e))) {
    return {...entry, verdict: 'cannot_tell', missing: 'no_state', demoted: 'no screenshot shows this state'};
  }
  if (entry.verdict === 'met') {
    const failed = evidence.filter(e => !resolves(e));
    if (failed.length === 0) return {...entry};
    return {
      ...entry,
      verdict: 'cannot_tell',
      missing: missingFor(failed),
      demoted: `${EVIDENCE_DEMOTION}${failed.map(e => `${e.kind} ${(e.ref ?? '').trim()}`.trim()).join('; ')}`,
    };
  }
  if (evidence.some(e => resolves(e))) return {...entry};
  problems.push(`criterion ${entry.criterion} is not_met but no evidence reference resolves`);
  return {...entry};
}

/** The capability a failed citation points at: a test that did not run, a state not shown, else data. */
function missingFor(failed: Evidence[]): Missing {
  if (failed.some(e => e.kind === 'test')) return 'no_test';
  if (failed.some(e => e.kind === 'screenshot')) return 'no_state';
  return 'no_data';
}

/** `block` if any criterion is not met, else `unclear` if any could not be told, else `pass`. */
export function reduceVerdict(entries: Pick<VerdictEntry, 'verdict'>[]): Decision {
  if (entries.some(e => e.verdict === 'not_met')) return 'block';
  if (entries.some(e => e.verdict === 'cannot_tell')) return 'unclear';
  return 'pass';
}
