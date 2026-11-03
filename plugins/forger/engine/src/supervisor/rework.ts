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
  /** The lines the PR deleted or replaced, as numbered before it; absent when the diff gave none. */
  replaced?: LineRange[];
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

/**
 * Files whose lines every ticket touches by design: docs and READMEs, the
 * loop's own bookkeeping, lockfiles and generated data. An overlap there says
 * nothing about the earlier change being wrong.
 */
export function isBookkeepingFile(file: string): boolean {
  return /\.(md|lock|lockb)$/i.test(file) || /(^|\/)(\.forger|\.claude)\//.test(file) || /(^|\/)(package-lock\.json|bun\.lockb?|backlog\.json)$/.test(file);
}

/**
 * The source files in which the later PR rewrote lines the earlier one wrote.
 * A later PR that only adds lines next to the earlier one's does not undo it,
 * so only the lines it deleted or replaced count.
 */
export function reworkedFiles(original: MergedPr, later: MergedPr): string[] {
  const touched = (later.replaced ?? later.ranges).filter(r => !isBookkeepingFile(r.file));
  return overlappingFiles(original.ranges.filter(r => !isBookkeepingFile(r.file)), touched);
}

/**
 * A later PR that names the earlier one, or the issue the earlier one closed,
 * builds on it on purpose (a follow-up, a ticket blocked by it). That is
 * planned work, not a correction.
 */
export function namesOriginal(later: MergedPr, original: MergedPr): boolean {
  const named = referencedNumbers(`${later.title}\n${later.body}`);
  return named.includes(original.number) || (original.closes !== null && named.includes(original.closes));
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
      if (namesOriginal(later, original)) continue;
      const files = reworkedFiles(original, later);
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

function pushLine(out: LineRange[], file: string, n: number): void {
  const last = out[out.length - 1];
  if (last !== undefined && last.file === file && last.end === n - 1) last.end = n;
  else out.push({file, start: n, end: n});
}

/**
 * The lines a unified diff changed, per file: the new-side numbers of the
 * lines it added and the old-side numbers of the lines it deleted. Context
 * lines around a hunk are not changes and are left out.
 */
export function parseDiffChanges(diff: string): {added: LineRange[]; deleted: LineRange[]} {
  const added: LineRange[] = [];
  const deleted: LineRange[] = [];
  let file: string | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  let oldN = 0;
  let newN = 0;
  for (const line of diff.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      const c = line[0];
      if (c === '-') {
        if (file !== null) pushLine(deleted, file, oldN);
        oldN += 1;
        oldLeft -= 1;
      } else if (c === '+') {
        if (file !== null) pushLine(added, file, newN);
        newN += 1;
        newLeft -= 1;
      } else if (c === '\\') {
        // "\ No newline at end of file" belongs to no line.
      } else {
        oldN += 1;
        newN += 1;
        oldLeft -= 1;
        newLeft -= 1;
      }
      continue;
    }
    const f = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
    if (f) {
      file = f[1] === '/dev/null' ? null : f[1];
      continue;
    }
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h) {
      oldN = Number(h[1]);
      oldLeft = h[2] === undefined ? 1 : Number(h[2]);
      newN = Number(h[3]);
      newLeft = h[4] === undefined ? 1 : Number(h[4]);
    }
  }
  return {added, deleted};
}

/** The lines a diff added, per file. */
export function parseDiffRanges(diff: string): LineRange[] {
  return parseDiffChanges(diff).added;
}

/** The lines a diff deleted or replaced, numbered as before the change. */
export function parseReplacedRanges(diff: string): LineRange[] {
  return parseDiffChanges(diff).deleted;
}

export function formatRework(r: ReworkMeasures): string[] {
  const pct = (s: number) => `${Math.round(s * 100)}%`;
  return [
    `rework (window ${r.window} merges): ${r.reworked} of ${r.merged} (${pct(r.rework_rate)}), ${r.pairs.map(p => `#${p.original}<-#${p.later} ${p.reason}`).join(', ') || 'no pairs'}`,
    `escaped defects: ${r.escaped_defects.length} on ${r.defective} PR(s) (${pct(r.escaped_defect_rate)}), pick vs built mismatches: ${r.pick_mismatches.length}`,
  ];
}
