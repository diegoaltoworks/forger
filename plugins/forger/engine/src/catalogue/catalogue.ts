/**
 * The failure catalogue's entries and their status. Each entry carries one
 * `**Status:**` line naming its fix tickets; the tracker decides whether the
 * entry is open or fixed, and a heading struck through with the merged PRs
 * shows it. Everything here is pure: the tracker's answers arrive as facts.
 */

export const CATALOGUE_PATH = 'docs/06-failure-catalogue.md';
export const CATALOGUE_OPINION = 'docs.catalogue-status';
export const INDEX_START = '<!-- catalogue-index:start -->';
export const INDEX_END = '<!-- catalogue-index:end -->';

/** What the tracker says about one ticket. `mergedPr` is set only when a merged PR closed it. */
export interface TicketFact {
  closed: boolean;
  mergedPr: number | null;
}

export type TicketFacts = ReadonlyMap<number, TicketFact>;

export type Status =
  | {kind: 'open'; tickets: number[]}
  | {kind: 'fixed'; tickets: number[]}
  | {kind: 'untracked'};

export interface Entry {
  title: string;
  /** 0-based line of the heading, and the exclusive end of the entry. */
  start: number;
  end: number;
  /** The status line, or null when the entry has none or it does not parse. */
  status: Status | null;
  /** 0-based line of the status line, or -1. */
  statusLine: number;
}

const HEADING = /^### (?:~~(.+?)~~ - fixed .+|(.+))$/;
const STATUS = /^\*\*Status:\*\* (.*)$/;
const UNTRACKED = 'fixed (before tickets were tracked)';

const refs = (s: string): number[] => [...s.matchAll(/#(\d+)/g)].map(m => Number(m[1]));

/** The status a line spells, or null when it spells none. */
export function parseStatus(text: string): Status | null {
  const t = text.trim();
  if (t === UNTRACKED) return {kind: 'untracked'};
  const open = /^open((?:, #\d+)*)$/.exec(t);
  if (open) return {kind: 'open', tickets: refs(open[1])};
  const fixed = /^fixed by (#\d+(?:, #\d+)*)$/.exec(t);
  return fixed ? {kind: 'fixed', tickets: refs(fixed[1])} : null;
}

export function formatStatus(s: Status): string {
  if (s.kind === 'untracked') return UNTRACKED;
  const list = s.tickets.map(n => `#${n}`).join(', ');
  return s.kind === 'open' ? ['open', ...(list ? [list] : [])].join(', ') : `fixed by ${list}`;
}

export function parseCatalogue(text: string): Entry[] {
  const lines = text.split('\n');
  const entries: Entry[] = [];
  let open: Entry | null = null;
  const close = (end: number): void => {
    if (open) entries.push({...open, end});
    open = null;
  };
  lines.forEach((line, i) => {
    if (/^#{1,2} /.test(line)) return close(i);
    const heading = HEADING.exec(line);
    if (heading) {
      close(i);
      open = {title: (heading[1] ?? heading[2]).trim(), start: i, end: i, status: null, statusLine: -1};
      return;
    }
    const status = open && open.statusLine < 0 ? STATUS.exec(line) : null;
    if (open && status) {
      open.statusLine = i;
      open.status = parseStatus(status[1]);
    }
  });
  close(lines.length);
  return entries;
}

/** What an entry's status should be, given the tracker. Null when a ticket is unknown to it. */
export function decide(status: Status, facts: TicketFacts): {status: Status; prs: number[]} | null {
  if (status.kind === 'untracked' || status.tickets.length === 0) return {status, prs: []};
  const seen = status.tickets.map(n => facts.get(n));
  if (seen.some(f => f === undefined)) return null;
  const prs = (seen as TicketFact[]).map(f => f.mergedPr);
  if (prs.every((p): p is number => p !== null)) return {status: {kind: 'fixed', tickets: status.tickets}, prs: [...new Set(prs)]};
  return {status: {kind: 'open', tickets: status.tickets}, prs: []};
}

function headingFor(title: string, status: Status, prs: number[]): string {
  if (status.kind === 'open') return `### ${title}`;
  return status.kind === 'untracked' ? `### ~~${title}~~ - fixed (before tickets were tracked)` : `### ~~${title}~~ - fixed by ${prs.map(p => `#${p}`).join(', ')}`;
}

/**
 * The entry's lines (the slice from its heading) rewritten from tracker facts: the status line and the
 * heading. Applying it again changes nothing. An entry the tracker cannot
 * answer for, or with no parseable status, comes back as it was.
 */
export function rewriteEntry(lines: string[], entry: Entry, facts: TicketFacts): string[] {
  if (!entry.status) return lines;
  const decided = decide(entry.status, facts);
  if (!decided) return lines;
  const out = [...lines];
  out[0] = headingFor(entry.title, decided.status, decided.prs);
  out[entry.statusLine - entry.start] = `**Status:** ${formatStatus(decided.status)}`;
  return out;
}

/** GitHub's anchor for a heading. */
export function anchorOf(heading: string): string {
  return heading
    .replace(/^#+ /, '')
    .replace(/[`~*]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** The index table, one row per entry, from the entries as they stand in `lines`. */
export function renderIndex(lines: string[]): string[] {
  const rows = parseCatalogue(lines.join('\n')).map(e => {
    const status = e.status ? formatStatus(e.status) : 'no status';
    return `| ${e.title} | ${status} | [entry](#${anchorOf(lines[e.start])}) |`;
  });
  return ['| Entry | Status | Link |', '|---|---|---|', ...rows];
}

/** The text with the index between its markers regenerated; a text without markers is returned as it was. */
export function withIndex(text: string): string {
  const lines = text.split('\n');
  const a = lines.indexOf(INDEX_START);
  const b = lines.indexOf(INDEX_END);
  if (a < 0 || b < a) return text;
  return [...lines.slice(0, a + 1), '', ...renderIndex(lines), '', ...lines.slice(b)].join('\n');
}

/** The whole catalogue rewritten from tracker facts, index included. */
export function updateCatalogue(text: string, facts: TicketFacts): string {
  const lines = text.split('\n');
  for (const entry of parseCatalogue(text)) {
    lines.splice(entry.start, entry.end - entry.start, ...rewriteEntry(lines.slice(entry.start, entry.end), entry, facts));
  }
  return withIndex(lines.join('\n'));
}

export interface CatalogueProblem {
  line: number;
  rule: 'catalogue-no-status' | 'catalogue-stale-status' | 'catalogue-stale-index';
  detail: string;
}

/**
 * Entries with no status, entries whose status or heading disagree with the
 * tracker, and an index that does not match. Without facts only the structure
 * is checked.
 */
export function checkCatalogue(text: string, facts: TicketFacts | null): CatalogueProblem[] {
  const lines = text.split('\n');
  const problems: CatalogueProblem[] = [];
  for (const entry of parseCatalogue(text)) {
    if (!entry.status) {
      problems.push({
        line: entry.start + 1,
        rule: 'catalogue-no-status',
        detail: `"${entry.title}" has no parseable **Status:** line ("open, #n", "fixed by #n" or "${UNTRACKED}")`,
      });
      continue;
    }
    if (!facts) continue;
    const before = lines.slice(entry.start, entry.end);
    const after = rewriteEntry(before, entry, facts);
    if (after.some((l, i) => l !== before[i])) {
      problems.push({
        line: entry.start + 1,
        rule: 'catalogue-stale-status',
        detail: `"${entry.title}" disagrees with the tracker; run \`catalogue --update\``,
      });
    }
  }
  if (problems.length === 0 && withIndex(text) !== text) {
    problems.push({line: lines.indexOf(INDEX_START) + 1, rule: 'catalogue-stale-index', detail: 'the index does not match the entries; run `catalogue --update`'});
  }
  return problems;
}

/** Every ticket the entries name, for one tracker lookup. */
export function ticketsOf(text: string): number[] {
  return [...new Set(parseCatalogue(text).flatMap(e => (e.status && e.status.kind !== 'untracked' ? e.status.tickets : [])))];
}
