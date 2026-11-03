/**
 * The verifier's verdict (ADR 0010) as a pure, checked record: the acceptance
 * criteria parsed from the issue, a validator that holds a verdict to them, and
 * the reducer that turns it into the one answer `merge` acts on. No I/O: whether
 * an evidence reference resolves is decided by a predicate the caller passes in.
 */

export type Judgement = 'met' | 'not_met' | 'cannot_tell';
export type Decision = 'pass' | 'block' | 'unclear';
export type EvidenceKind = 'file' | 'command' | 'test';

export interface Evidence {
  kind: EvidenceKind;
  /** A file with line, a command, or a test name. */
  ref: string;
}

export interface Criterion {
  id: string;
  text: string;
}

export interface VerdictEntry {
  criterion: string;
  verdict: Judgement;
  evidence: Evidence[];
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
    entries.push(settle(entry, resolves, problems));
  }

  for (const c of criteria) {
    if (!seen.has(c.id)) problems.push(`missing criterion ${c.id}: ${c.text}`);
  }

  const order = new Map(criteria.map((c, i) => [c.id, i]));
  entries.sort((a, b) => (order.get(a.criterion) ?? 0) - (order.get(b.criterion) ?? 0));
  return {problems, entries};
}

function settle(entry: VerdictEntry, resolves: (e: Evidence) => boolean, problems: string[]): CheckedEntry {
  if (entry.verdict === 'cannot_tell') return {...entry};
  const evidence = entry.evidence ?? [];
  if (evidence.length === 0) {
    problems.push(`criterion ${entry.criterion} is ${entry.verdict} without evidence`);
    return {...entry};
  }
  if (evidence.some(e => resolves(e))) return {...entry};
  if (entry.verdict === 'met') {
    return {...entry, verdict: 'cannot_tell', demoted: 'no evidence reference resolves'};
  }
  problems.push(`criterion ${entry.criterion} is not_met but no evidence reference resolves`);
  return {...entry};
}

/** `block` if any criterion is not met, else `unclear` if any could not be told, else `pass`. */
export function reduceVerdict(entries: Pick<VerdictEntry, 'verdict'>[]): Decision {
  if (entries.some(e => e.verdict === 'not_met')) return 'block';
  if (entries.some(e => e.verdict === 'cannot_tell')) return 'unclear';
  return 'pass';
}
