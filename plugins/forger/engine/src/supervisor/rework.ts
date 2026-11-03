/**
 * Rework and escaped defects per merged ticket (ADR 0013). Pure over merged
 * PRs, issues and the pick events; the CLI gathers the inputs from git and the
 * tracker and does no arithmetic.
 */

export const DEFAULT_REWORK_WINDOW = 5;

/** A run of lines a PR touched in one file, 1-based and inclusive. */
export interface LineRange {
  file: string;
  start: number;
  end: number;
}

export interface MergedPr {
  number: number;
  /** Position in merge order; a later merge has a larger value. */
  order: number;
  title: string;
  body: string;
  /** The issue the PR closes, if any. */
  closes: number | null;
  ranges: LineRange[];
}

export interface TrackerIssue {
  number: number;
  labels: string[];
  body: string;
}

export interface PickRecord {
  /** The ticket id the engine picked, such as `issue-114`. */
  ticket: string;
  /** The merged PR the run produced. */
  pr: number;
}

/** Pairs each pick event with the merged PR its iteration built, through the ticket the iteration log names. */
export function picksToPrs(
  picked: {iteration: number; ticket: string | null}[],
  built: {iteration: number; ticket: string | null}[],
  prs: MergedPr[]
): PickRecord[] {
  const out: PickRecord[] = [];
  for (const p of picked) {
    if (p.ticket === null) continue;
    const ticket = built.find(b => b.iteration === p.iteration)?.ticket;
    const n = ticket === undefined || ticket === null ? null : /^issue-(\d+)$/.exec(ticket)?.[1];
    const pr = n == null ? undefined : prs.find(x => x.closes === Number(n));
    if (pr !== undefined) out.push({ticket: p.ticket, pr: pr.number});
  }
  return out;
}

export interface ReworkInputs {
  prs: MergedPr[];
  issues: TrackerIssue[];
  picks: PickRecord[];
  /** Later merges that still count as rework of an earlier one. */
  window?: number;
}

export type ReworkReason = 'overlap' | 'revert';

export interface ReworkPair {
  original: number;
  later: number;
  reason: ReworkReason;
  /** The files whose lines overlap; empty for a revert. */
  files: string[];
}

export interface EscapedDefect {
  issue: number;
  pr: number;
}

export interface PickMismatch {
  pr: number;
  picked: string;
  built: string | null;
}

export interface ReworkMeasures {
  window: number;
  merged: number;
  pairs: ReworkPair[];
  /** Merged PRs reworked inside the window by a later one. */
  reworked: number;
  rework_rate: number;
  escaped_defects: EscapedDefect[];
  /** Merged PRs a defect issue names. */
  defective: number;
  escaped_defect_rate: number;
  pick_mismatches: PickMismatch[];
}

/** The PR or issue numbers a text names with `#n`, in order, without repeats. */
export function referencedNumbers(text: string): number[] {
  const seen: number[] = [];
  for (const m of text.matchAll(/(?<![\w&])#(\d+)\b/g)) {
    const n = Number(m[1]);
    if (!seen.includes(n)) seen.push(n);
  }
  return seen;
}

export function rangesOverlap(a: LineRange, b: LineRange): boolean {
  return a.file === b.file && a.start <= b.end && b.start <= a.end;
}

/** The files in which any range of `a` overlaps any range of `b`. */
export function overlappingFiles(a: LineRange[], b: LineRange[]): string[] {
  const files = new Set<string>();
  for (const x of a) for (const y of b) if (rangesOverlap(x, y)) files.add(x.file);
  return [...files].sort();
}

export function isRevert(pr: MergedPr): boolean {
  return /^revert\b/i.test(pr.title.trim());
}

export function computeRework(inputs: ReworkInputs): ReworkMeasures {
  const window = inputs.window ?? DEFAULT_REWORK_WINDOW;
  const prs = [...inputs.prs].sort((a, b) => a.order - b.order);
  const byNumber = new Map(prs.map(p => [p.number, p]));
  const pairs: ReworkPair[] = [];

  for (const later of prs) {
    const named = isRevert(later) ? referencedNumbers(`${later.title}\n${later.body}`) : [];
    for (const original of prs) {
      const gap = later.order - original.order;
      if (gap < 1 || gap > window) continue;
      if (named.includes(original.number)) {
        pairs.push({original: original.number, later: later.number, reason: 'revert', files: []});
        continue;
      }
      const files = overlappingFiles(original.ranges, later.ranges);
      if (files.length > 0) pairs.push({original: original.number, later: later.number, reason: 'overlap', files});
    }
  }

  const escaped: EscapedDefect[] = [];
  for (const issue of [...inputs.issues].sort((a, b) => a.number - b.number)) {
    if (!issue.labels.includes('bug')) continue;
    for (const n of referencedNumbers(issue.body)) if (byNumber.has(n) && n !== issue.number) escaped.push({issue: issue.number, pr: n});
  }

  const mismatches: PickMismatch[] = [];
  for (const pick of inputs.picks) {
    const pr = byNumber.get(pick.pr);
    if (pr === undefined) continue;
    const built = pr.closes === null ? null : `issue-${pr.closes}`;
    if (built !== pick.ticket) mismatches.push({pr: pick.pr, picked: pick.ticket, built});
  }

  const reworked = new Set(pairs.map(p => p.original)).size;
  const defective = new Set(escaped.map(d => d.pr)).size;
  const rate = (n: number) => (prs.length === 0 ? 0 : n / prs.length);
  return {
    window,
    merged: prs.length,
    pairs,
    reworked,
    rework_rate: rate(reworked),
    escaped_defects: escaped,
    defective,
    escaped_defect_rate: rate(defective),
    pick_mismatches: mismatches,
  };
}

/** The new-side line ranges per file in a unified diff. */
export function parseDiffRanges(diff: string): LineRange[] {
  const out: LineRange[] = [];
  let file: string | null = null;
  for (const line of diff.split('\n')) {
    const f = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
    if (f) {
      file = f[1] === '/dev/null' ? null : f[1];
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && file !== null) {
      const start = Number(h[1]);
      const len = h[2] === undefined ? 1 : Number(h[2]);
      if (len > 0) out.push({file, start, end: start + len - 1});
    }
  }
  return out;
}

export function formatRework(r: ReworkMeasures): string[] {
  const pct = (s: number) => `${Math.round(s * 100)}%`;
  return [
    `rework (window ${r.window} merges): ${r.reworked} of ${r.merged} (${pct(r.rework_rate)}), ${r.pairs.map(p => `#${p.original}<-#${p.later} ${p.reason}`).join(', ') || 'no pairs'}`,
    `escaped defects: ${r.escaped_defects.length} on ${r.defective} PR(s) (${pct(r.escaped_defect_rate)}), pick vs built mismatches: ${r.pick_mismatches.length}`,
  ];
}
