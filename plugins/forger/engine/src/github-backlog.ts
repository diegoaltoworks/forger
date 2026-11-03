/**
 * The Backlog read from GitHub Issues (ADR 0001). One GraphQL query fetches
 * every issue carrying the intake label, open or closed, with its labels, the
 * PR that closed it and its native blocked-by issues. The mapping from issues
 * to tickets is pure and tested against recorded responses; the gh call goes
 * through the injectable CommandRunner.
 */

import {type Backlog, type BacklogData, type Ticket, backlogFrom} from './backlog';
import type {WorkloopConfig} from './config';
import type {CommandRunner} from './git';

export interface IssueNode {
  number: number;
  state: string;
  labels?: {nodes?: Array<{name: string}>};
  timelineItems?: {nodes?: Array<{closer?: {__typename?: string; merged?: boolean} | null}>};
}

export interface TrackedIssue extends IssueNode {
  blockedBy?: {nodes?: IssueNode[]};
}

export type TrackerSettings = WorkloopConfig['tracker'];

const CLOSER = `timelineItems(itemTypes: [CLOSED_EVENT], last: 1) {
  nodes { ... on ClosedEvent { closer { __typename ... on PullRequest { merged } } } }
}`;

export const ISSUES_QUERY = `query($owner: String!, $repo: String!, $label: String!, $endCursor: String) {
  repository(owner: $owner, name: $repo) {
    issues(first: 100, after: $endCursor, labels: [$label], states: [OPEN, CLOSED]) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number state
        labels(first: 50) { nodes { name } }
        ${CLOSER}
        blockedBy(first: 50) { nodes { number state labels(first: 50) { nodes { name } } ${CLOSER} } }
      }
    }
  }
}`;

export function ticketId(issue: number): string {
  return `issue-${issue}`;
}

function labelsOf(issue: IssueNode): string[] {
  return (issue.labels?.nodes ?? []).map(l => l.name);
}

/** `wayfinder:*` matches any label starting `wayfinder:`; anything else matches exactly. */
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
 * issue. Ignored issues are dropped; a blocker outside the fetched set is kept
 * as a ticket of its own so its dependants can see whether it is done.
 */
export function backlogFromIssues(issues: TrackedIssue[], tracker: TrackerSettings): BacklogData {
  const features: Record<string, Ticket> = {};
  const sorted = [...issues].sort((a, b) => a.number - b.number);
  for (const issue of sorted) {
    if (isIgnored(labelsOf(issue), tracker)) continue;
    features[ticketId(issue.number)] = ticketFromIssue(issue, tracker);
  }
  const all = new Set(issues.map(i => i.number));
  for (const issue of sorted) {
    for (const blocker of issue.blockedBy?.nodes ?? []) {
      const id = ticketId(blocker.number);
      if (all.has(blocker.number) || features[id]) continue;
      features[id] = {status: issueStatus(blocker, tracker), issue: blocker.number};
    }
  }
  return {features};
}

/**
 * The issues from `gh api graphql --paginate --slurp`: an array of pages.
 * Anything else throws - an unreadable tracker must never read as an empty
 * backlog, or the loop would stop as if every ticket were done.
 */
export function parseIssuesResponse(raw: string): TrackedIssue[] {
  if (raw.trim() === '') throw new Error('GitHub backlog: gh returned nothing (not authenticated, or offline?)');
  let pages: unknown;
  try {
    pages = JSON.parse(raw);
  } catch {
    throw new Error('GitHub backlog: gh returned invalid JSON');
  }
  if (!Array.isArray(pages)) throw new Error('GitHub backlog: expected an array of pages');
  const issues: TrackedIssue[] = [];
  for (const page of pages) {
    const nodes = (page as {data?: {repository?: {issues?: {nodes?: unknown}}}})?.data?.repository
      ?.issues?.nodes;
    if (!Array.isArray(nodes)) throw new Error('GitHub backlog: a page has no issues');
    issues.push(...(nodes as TrackedIssue[]));
  }
  return issues;
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

export function readIssueBacklog(run: CommandRunner, tracker: TrackerSettings): BacklogData {
  return backlogFromIssues(parseIssuesResponse(run(issuesCommand(tracker))), tracker);
}

export function githubBacklog(run: CommandRunner, config: WorkloopConfig): Backlog {
  return backlogFrom(() => readIssueBacklog(run, config.tracker), config);
}
