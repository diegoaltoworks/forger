/**
 * The failure catalogue: an Open table and a Fixed table, one row per failure.
 * The tracker decides which table a row belongs in: a row is fixed once every
 * issue in it is closed by a merged PR. Everything here is pure: the tracker's
 * answers arrive as facts.
 */

export const CATALOGUE_PATH = 'docs/06-failure-catalogue.md';
export const CATALOGUE_OPINION = 'docs.catalogue-status';
export const UNTRACKED = 'before tickets were tracked';
const MERGED_IN = ' - merged in ';

/** What the tracker says about one ticket. `mergedPr` is set only when a merged PR closed it. */
export interface TicketFact {
  closed: boolean;
  mergedPr: number | null;
}

export type TicketFacts = ReadonlyMap<number, TicketFact>;

export type Section = 'open' | 'fixed';

export interface Row {
  title: string;
  /** One line on what the failure looks like. */
  looks: string;
  /** The issues that fix it; empty for a failure fixed before tickets were tracked. */
  tickets: number[];
  /** The merged PRs that closed them; only a fixed row has any. */
  prs: number[];
  /** 0-based line in the text. */
  line: number;
}

export interface Catalogue {
  open: Row[];
  fixed: Row[];
  /** `###` headings: the per-entry sections the catalogue no longer has. */
  entrySections: number[];
  /** Whether each section heading is present, once. */
  hasOpen: boolean;
  hasFixed: boolean;
}

const refs = (s: string): number[] => [...s.matchAll(/#(\d+)/g)].map(m => Number(m[1]));

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => c.trim());

function parseRow(line: string, i: number): Row | null {
  const [title, looks, by = ''] = cells(line);
  if (!title || /^-+$/.test(title) || title === 'Failure') return null;
  const [issues, merged = ''] = by.split(MERGED_IN);
  return {title, looks: looks ?? '', tickets: refs(issues), prs: refs(merged), line: i};
}

export function parseCatalogue(text: string): Catalogue {
  const out: Catalogue = {open: [], fixed: [], entrySections: [], hasOpen: false, hasFixed: false};
  let section: Section | null = null;
  text.split('\n').forEach((line, i) => {
    if (/^### /.test(line)) out.entrySections.push(i);
    if (/^#{1,2} /.test(line)) {
      section = /^## Open\s*$/.test(line) ? 'open' : /^## Fixed\s*$/.test(line) ? 'fixed' : null;
      if (section === 'open') out.hasOpen = true;
      if (section === 'fixed') out.hasFixed = true;
      return;
    }
    if (!section || !line.startsWith('|')) return;
    const row = parseRow(line, i);
    if (row) out[section].push(row);
  });
  return out;
}

/** Facts the tracker holds for every ticket of the catalogue, for one lookup. */
export function ticketsOf(text: string): number[] {
  const c = parseCatalogue(text);
  return [...new Set([...c.open, ...c.fixed].flatMap(r => r.tickets))];
}

/** The repository's URL as the catalogue already links it, or null when it links nothing. */
export function baseOf(text: string): string | null {
  return /(https:\/\/github\.com\/[^/\s)]+\/[^/\s)]+)\/(?:issues|pull)\/\d+/.exec(text)?.[1] ?? null;
}

const link = (base: string | null, kind: 'issues' | 'pull', n: number): string => (base ? `[#${n}](${base}/${kind}/${n})` : `#${n}`);

function cellOf(section: Section, row: Row, base: string | null): string {
  const issues = row.tickets.map(n => link(base, 'issues', n)).join(', ');
  if (section === 'open') return issues;
  if (row.tickets.length === 0) return UNTRACKED;
  return `${issues}${MERGED_IN}${row.prs.map(n => link(base, 'pull', n)).join(', ')}`;
}

const HEADERS: Record<Section, string[]> = {
  open: ['| Failure | What it looks like | Issue |', '|---|---|---|'],
  fixed: ['| Failure | What it looked like | Fixed by |', '|---|---|---|'],
};

export function renderRow(section: Section, row: Row, base: string | null): string {
  return `| ${row.title} | ${row.looks} | ${cellOf(section, row, base)} |`;
}

/** Which table a row belongs in, and the PRs that closed it. Null when a ticket is unknown to the tracker. */
export function decide(row: Row, facts: TicketFacts): {section: Section; prs: number[]} | null {
  if (row.tickets.length === 0) return {section: 'fixed', prs: []};
  const seen = row.tickets.map(n => facts.get(n));
  if (seen.some(f => f === undefined)) return null;
  const prs = (seen as TicketFact[]).map(f => f.mergedPr);
  return prs.every((p): p is number => p !== null) ? {section: 'fixed', prs: [...new Set(prs)]} : {section: 'open', prs: []};
}

/** True when none of the row's issues is open, so an Open row has nothing left to fix it. */
function noOpenIssue(row: Row, facts: TicketFacts): boolean {
  return !row.tickets.some(n => facts.get(n)?.closed === false);
}

/**
 * The text with every row in the table the tracker says it belongs in, and
 * each row's PRs named. Applying it again changes nothing. A row the tracker
 * cannot answer for stays where it is; a row with no issue in the Open table
 * stays there too, for the check to name.
 */
export function updateCatalogue(text: string, facts: TicketFacts): string {
  const c = parseCatalogue(text);
  const base = baseOf(text);
  const placed: Record<Section, Row[]> = {open: [], fixed: []};
  const moved: Record<Section, Row[]> = {open: [], fixed: []};
  for (const section of ['open', 'fixed'] as const) {
    for (const row of c[section]) {
      const decided = section === 'open' && row.tickets.length === 0 ? {section, prs: row.prs} : decide(row, facts);
      const to = decided?.section ?? section;
      const next = {...row, prs: decided ? decided.prs : row.prs};
      (to === section ? placed : moved)[to].push(next);
    }
  }
  const rows = (section: Section): string[] => [...placed[section], ...moved[section]].map(r => renderRow(section, r, base));
  return replaceTables(text, {open: rows('open'), fixed: rows('fixed')});
}

/** The text with each section's table lines replaced; a section with no table gets one under its heading. */
function replaceTables(text: string, rows: Record<Section, string[]>): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let section: Section | null = null;
  let pending: Section | null = null;
  const flush = (): void => {
    if (pending) out.push(...HEADERS[pending], ...rows[pending], '');
    pending = null;
  };
  for (const line of lines) {
    if (/^#{1,2} /.test(line)) {
      flush();
      section = /^## Open\s*$/.test(line) ? 'open' : /^## Fixed\s*$/.test(line) ? 'fixed' : null;
      out.push(line);
      if (section) {
        out.push('');
        pending = section;
      }
      continue;
    }
    if (section && (line.startsWith('|') || (pending && line === ''))) continue;
    flush();
    out.push(line);
  }
  flush();
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
}

export interface CatalogueProblem {
  line: number;
  rule:
    | 'catalogue-no-table'
    | 'catalogue-entry-section'
    | 'catalogue-open-no-issue'
    | 'catalogue-open-own-ticket'
    | 'catalogue-fixed-no-merge'
    | 'catalogue-stale-status';
  detail: string;
}

/**
 * The facts as the tracker will hold them once the branch working `ticket`
 * merges. A PR cannot see its own issue closed before it merges, so a Fixed row
 * naming the ticket and its PR counts that ticket closed by the PR the row
 * names: the one no other ticket in the row was closed by. With no such row,
 * an open PR of the branch is the one that will close it (`open`), for the update.
 */
export function factsOnMerge(text: string, facts: TicketFacts, ticket: number | null, open: number | null = null): TicketFacts {
  if (ticket === null || facts.get(ticket)?.closed !== false) return facts;
  const row = parseCatalogue(text).fixed.find(r => r.tickets.includes(ticket));
  if (!row) return open === null ? facts : new Map([...facts, [ticket, {closed: true, mergedPr: open}]]);
  const others = new Set(row.tickets.filter(n => n !== ticket).map(n => facts.get(n)?.mergedPr));
  const pr = row.prs.find(p => !others.has(p)) ?? row.prs[0];
  if (pr === undefined) return facts;
  return new Map([...facts, [ticket, {closed: true, mergedPr: pr}]]);
}

/**
 * A catalogue without both tables, one with an entry section, an Open row with
 * no open issue, and rows that disagree with the tracker. Without facts only
 * the structure is checked. `ticket` is the one the branch being checked
 * works, judged as it will be after its merge (see `factsOnMerge`). Once that
 * branch has an open PR (`pr`), an Open row whose only open issue is `ticket`
 * fails: the merge closes the issue and leaves the row Open.
 */
export function checkCatalogue(text: string, tracker: TicketFacts | null, ticket: number | null = null, pr: number | null = null): CatalogueProblem[] {
  const facts = tracker && factsOnMerge(text, tracker, ticket);
  const c = parseCatalogue(text);
  const problems: CatalogueProblem[] = [];
  if (!c.hasOpen) problems.push({line: 1, rule: 'catalogue-no-table', detail: 'there is no "## Open" section'});
  if (!c.hasFixed) problems.push({line: 1, rule: 'catalogue-no-table', detail: 'there is no "## Fixed" section'});
  for (const i of c.entrySections) {
    problems.push({line: i + 1, rule: 'catalogue-entry-section', detail: 'an entry section; a failure is one row in a table, and its issue holds the detail'});
  }
  for (const row of c.open) {
    if (row.tickets.length === 0) {
      problems.push({line: row.line + 1, rule: 'catalogue-open-no-issue', detail: `"${row.title}" is Open and links no issue; open one for it`});
    } else if (facts && pr !== null && ticket !== null && row.tickets.includes(ticket) && facts.get(ticket)?.closed === false && noOpenIssue({...row, tickets: row.tickets.filter(n => n !== ticket)}, facts)) {
      problems.push({line: row.line + 1, rule: 'catalogue-open-own-ticket', detail: `"${row.title}" is Open and its only open issue is #${ticket}, which this branch's PR #${pr} closes; run \`catalogue --update\` to move it to Fixed`});
    } else if (facts && row.tickets.every(n => facts.has(n)) && noOpenIssue(row, facts)) {
      problems.push({line: row.line + 1, rule: 'catalogue-open-no-issue', detail: `"${row.title}" is Open and none of its issues is open; open one, or run \`catalogue --update\``});
    }
  }
  for (const row of c.fixed) {
    if (row.tickets.length > 0 && row.prs.length === 0) {
      problems.push({line: row.line + 1, rule: 'catalogue-fixed-no-merge', detail: `"${row.title}" is Fixed but names no merged PR`});
    }
  }
  if (facts && problems.every(p => p.rule !== 'catalogue-open-no-issue' && p.rule !== 'catalogue-open-own-ticket') && updateCatalogue(text, facts) !== text) {
    problems.push({line: 1, rule: 'catalogue-stale-status', detail: 'a row disagrees with the tracker; run `catalogue --update`'});
  }
  return problems;
}
