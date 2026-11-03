/**
 * The Backlog read from GitHub Issues (ADR 0001). One GraphQL query fetches the
 * open issues carrying the intake label, with their labels and their native
 * blocked-by issues (each with the PR that closed it), plus the most recently
 * closed intake issues - enough to see the ticket an iteration just closed.
 * Older closed issues are never scanned: a dependency's status comes with the
 * blocker itself. The mapping from issues to tickets is pure and tested against
 * recorded responses; the gh call goes through an injectable runner.
 */

import {type Backlog, type BacklogData, type Ticket, backlogFrom} from './backlog';
import type {WorkloopConfig} from '../config';
import type {CapturingRunner} from '../ports';
import {RateLimitError, isRateLimited, parseRateLimit} from '../loop';

interface Page<T> {
  totalCount?: number;
  nodes?: T[];
}

export interface IssueNode {
  number: number;
  state: string;
  labels?: Page<{name: string}>;
  timelineItems?: {nodes?: Array<{closer?: {__typename?: string; merged?: boolean} | null}>};
}

export interface TrackedIssue extends IssueNode {
  blockedBy?: Page<IssueNode>;
}

export type TrackerSettings = WorkloopConfig['tracker'];

/**
 * Page sizes, kept small because cost multiplies down the nesting. A list that
 * outgrows its page fails the read loudly (see truncatedLists) rather than
 * dropping a label or a blocker.
 */
export const PAGE = {issues: 30, labels: 20, blockers: 5, recentlyClosed: 20} as const;

/** The most the backlog query may cost, in GitHub rate-limit points. */
export const QUERY_COST_BUDGET = 5;

const CLOSER = `timelineItems(itemTypes: [CLOSED_EVENT], last: 1) {
  nodes { ... on ClosedEvent { closer { __typename ... on PullRequest { merged } } } }
}`;

const LABELS = `labels(first: ${PAGE.labels}) { totalCount nodes { name } }`;

export const ISSUES_QUERY = `query($owner: String!, $repo: String!, $label: String!, $endCursor: String) {
  repository(owner: $owner, name: $repo) {
    issues(first: ${PAGE.issues}, after: $endCursor, labels: [$label], states: [OPEN]) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number state
        ${LABELS}
        blockedBy(first: ${PAGE.blockers}) { totalCount nodes { number state ${LABELS} ${CLOSER} } }
      }
    }
    closed: issues(first: ${PAGE.recentlyClosed}, labels: [$label], states: [CLOSED], orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { number state ${LABELS} ${CLOSER} }
    }
  }
}`;

export function ticketId(issue: number): string {
  return `issue-${issue}`;
}

function labelsOf(issue: IssueNode): string[] {
  return (issue.labels?.nodes ?? []).map(l => l.name);
}

export function labelMatches(label: string, pattern: string): boolean {
  return pattern.endsWith('*') ? label.startsWith(pattern.slice(0, -1)) : label === pattern;
}

function isIgnored(labels: string[], tracker: TrackerSettings): boolean {
  return labels.some(l => tracker.ignore.some(p => labelMatches(l, p)));
}

/**
 * Closed by a merged PR, from the issue's last close event. An issue closed by
 * hand, or by a PR that was closed unmerged, is not.
 */
export function closedByMergedPr(issue: IssueNode): boolean {
  if (issue.state !== 'CLOSED') return false;
  const events = issue.timelineItems?.nodes ?? [];
  const closer = events[events.length - 1]?.closer;
  return closer?.__typename === 'PullRequest' && closer.merged === true;
}

/**
 * A ticket's status from its issue. Only an open issue with the intake label is
 * work to start. An issue that is not work - no intake label, or an ignored
 * label - is only ever seen as a blocker: it is satisfied once closed, since a
 * decision closes without a PR.
 */
export function issueStatus(issue: IssueNode, tracker: TrackerSettings): string {
  const labels = labelsOf(issue);
  const isWork = labels.includes(tracker.label) && !isIgnored(labels, tracker);
  if (!isWork) return issue.state === 'CLOSED' ? 'completed' : 'untracked';
  if (issue.state === 'CLOSED') return closedByMergedPr(issue) ? 'completed' : 'closed';
  if (labels.includes('needs-human')) return 'needs_human';
  if (labels.includes('deferred')) return 'deferred';
  return 'not_started';
}

export function ticketFromIssue(issue: TrackedIssue, tracker: TrackerSettings): Ticket {
  const labels = labelsOf(issue);
  const ticket: Ticket = {status: issueStatus(issue, tracker), issue: issue.number};
  const priority = labels.find(l => /^P[0-3]$/.test(l));
  if (priority) ticket.priority = priority;
  const effort = labels.find(l => l.startsWith('effort:'));
  if (effort) ticket.effort = effort.slice('effort:'.length);
  const blockers = issue.blockedBy?.nodes ?? [];
  if (blockers.length > 0) ticket.depends_on = blockers.map(b => ticketId(b.number));
  return ticket;
}

/**
 * Tickets keyed `issue-<n>`, in issue order so equal priorities pick the older
 * issue. Ignored issues and blockers outside the fetched set are kept, never as
 * work, so their dependants can see whether they are done.
 */
export function backlogFromIssues(issues: TrackedIssue[], tracker: TrackerSettings): BacklogData {
  const features: Record<string, Ticket> = {};
  const sorted = [...issues].sort((a, b) => a.number - b.number);
  for (const issue of sorted) {
    features[ticketId(issue.number)] = isIgnored(labelsOf(issue), tracker)
      ? {status: issueStatus(issue, tracker), issue: issue.number}
      : ticketFromIssue(issue, tracker);
  }
  for (const issue of sorted) {
    for (const blocker of issue.blockedBy?.nodes ?? []) {
      const id = ticketId(blocker.number);
      if (!features[id]) features[id] = {status: issueStatus(blocker, tracker), issue: blocker.number};
    }
  }
  return {features};
}

/**
 * The issues from `gh api graphql --paginate --slurp`: an array of pages, each
 * with the open issues and the recently closed ones (repeated on every page, so
 * an issue is kept once). Anything else throws - an unreadable tracker must
 * never read as an empty backlog, or the loop would stop as if every ticket
 * were done.
 */
export function parseIssuesResponse(raw: string): TrackedIssue[] {
  if (raw.trim() === '') throw new Error('GitHub backlog: gh printed nothing');
  let pages: unknown;
  try {
    pages = JSON.parse(raw);
  } catch {
    throw new Error('GitHub backlog: gh returned invalid JSON');
  }
  if (!Array.isArray(pages)) throw new Error('GitHub backlog: expected an array of pages');
  const issues = new Map<number, TrackedIssue>();
  for (const page of pages) {
    const repo = (page as {data?: {repository?: {issues?: {nodes?: unknown}; closed?: {nodes?: unknown}}}})?.data
      ?.repository;
    const nodes = repo?.issues?.nodes;
    if (!Array.isArray(nodes)) throw new Error('GitHub backlog: a page has no issues');
    const closed = Array.isArray(repo?.closed?.nodes) ? (repo.closed.nodes as TrackedIssue[]) : [];
    for (const issue of [...(nodes as TrackedIssue[]), ...closed]) {
      if (!issues.has(issue.number)) issues.set(issue.number, issue);
    }
  }
  const truncated = truncatedLists([...issues.values()]);
  if (truncated.length > 0) {
    throw new Error(`GitHub backlog: more than a page of ${truncated.join(', ')}; raise PAGE in github-backlog.ts`);
  }
  return [...issues.values()];
}

function isTruncated(page: Page<unknown> | undefined): boolean {
  return typeof page?.totalCount === 'number' && page.totalCount > (page.nodes?.length ?? 0);
}

/** Lists the query cut short; a missing label or blocker would change the pick. */
export function truncatedLists(issues: TrackedIssue[]): string[] {
  const found: string[] = [];
  for (const issue of issues) {
    if (isTruncated(issue.labels)) found.push(`labels on #${issue.number}`);
    if (isTruncated(issue.blockedBy)) found.push(`blockers on #${issue.number}`);
    for (const b of issue.blockedBy?.nodes ?? []) {
      if (isTruncated(b.labels)) found.push(`labels on #${b.number}`);
    }
  }
  return found;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function issuesCommand(tracker: TrackerSettings): string {
  return [
    'gh api graphql --paginate --slurp',
    `-F owner='{owner}' -F repo='{repo}'`,
    `-f label=${shellQuote(tracker.label)}`,
    `-f query=${shellQuote(ISSUES_QUERY)}`,
  ].join(' ');
}

export const RATE_LIMIT_COMMAND = 'gh api rate_limit';

/**
 * Why a gh call gave no backlog, from what gh printed. A rate limit becomes a
 * RateLimitError carrying the reset, read from `gh api rate_limit` (which the
 * limit does not count).
 */
export function ghFailure(run: CapturingRunner, exitCode: number, stderr: string): Error {
  if (isRateLimited(stderr)) {
    const limits = run(RATE_LIMIT_COMMAND);
    return new RateLimitError('graphql', limits.exitCode === 0 ? parseRateLimit(limits.stdout, 'graphql') : null, stderr);
  }
  const said = stderr.trim() === '' ? 'nothing on stderr' : `on stderr: ${stderr.trim()}`;
  return new Error(`GitHub backlog: gh exited ${exitCode} with no output, ${said}`);
}

export function readIssueBacklog(run: CapturingRunner, tracker: TrackerSettings): BacklogData {
  const result = run(issuesCommand(tracker));
  if (result.exitCode !== 0 || result.stdout.trim() === '') {
    throw ghFailure(run, result.exitCode, result.stderr);
  }
  return backlogFromIssues(parseIssuesResponse(result.stdout), tracker);
}

export function githubBacklog(run: CapturingRunner, config: WorkloopConfig): Backlog {
  return backlogFrom(() => readIssueBacklog(run, config.tracker), config);
}
