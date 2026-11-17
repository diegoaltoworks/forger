/** From the answer of the Jira search to the backlog's data. Pure. */

import type {BacklogData, Ticket} from '../backlog';
import {type WorkloopConfig, jiraOf} from '../../config';
import {adfToMarkdown} from '../../tracker';

type Tracker = WorkloopConfig['tracker'];

interface Status {
  statusCategory?: {key?: string};
}

interface LinkedIssue {
  key: string;
  fields?: {status?: Status};
}

export interface JiraIssue {
  key: string;
  fields?: {
    labels?: string[];
    status?: Status;
    priority?: {name?: string} | null;
    description?: unknown;
    issuelinks?: Array<{type?: {name?: string}; inwardIssue?: LinkedIssue; outwardIssue?: LinkedIssue}>;
    [field: string]: unknown;
  };
}

export interface SearchPage {
  issues: JiraIssue[];
  nextPageToken?: string;
}

/** The number in a key: `KEY-123` is 123. */
export function issueNumber(key: string): number | null {
  const m = /-(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

const ticketId = (n: number): string => `issue-${n}`;

function isDone(status: Status | undefined): boolean {
  return status?.statusCategory?.key === 'done';
}

function labelsOf(issue: JiraIssue): string[] {
  return issue.fields?.labels ?? [];
}

/** Not work when an ignored label is on it; an issue found only as a blocker is the same. */
function isIgnored(labels: string[], tracker: Tracker): boolean {
  return labels.some(l => tracker.ignore.some(p => (p.endsWith('*') ? l.startsWith(p.slice(0, -1)) : l === p)));
}

export function jiraStatus(issue: JiraIssue, tracker: Tracker): string {
  const labels = labelsOf(issue);
  if (isDone(issue.fields?.status) || labels.includes('merged')) return 'completed';
  if (isIgnored(labels, tracker)) return 'untracked';
  if (labels.includes('owner-review')) return 'owner_review';
  if (labels.includes('needs-human')) return 'needs_human';
  if (labels.includes('needs-info')) return 'needs_info';
  if (labels.includes('deferred')) return 'deferred';
  return 'not_started';
}

function priorityOf(issue: JiraIssue, tracker: Tracker): string | undefined {
  const label = labelsOf(issue).find(l => /^P[0-3]$/.test(l));
  if (label) return label;
  const name = issue.fields?.priority?.name;
  return name ? jiraOf(tracker).priority[name] : undefined;
}

function effortOf(issue: JiraIssue, tracker: Tracker): string | undefined {
  const label = labelsOf(issue).find(l => l.startsWith('effort:'));
  if (label) return label.slice('effort:'.length);
  const setting = jiraOf(tracker).effort;
  const value = setting ? issue.fields?.[setting.field] : undefined;
  if (!setting || typeof value !== 'number') return undefined;
  return value <= setting.small_max ? 'small' : value <= setting.medium_max ? 'medium' : 'large';
}

/** The issues that block this one: the inward side of a link of the configured type. */
function blockers(issue: JiraIssue, tracker: Tracker): LinkedIssue[] {
  return (issue.fields?.issuelinks ?? [])
    .filter(l => l.type?.name === jiraOf(tracker).blocks_link && l.inwardIssue)
    .map(l => l.inwardIssue as LinkedIssue);
}

function bodyOf(issue: JiraIssue): string | undefined {
  const d = issue.fields?.description;
  if (!d || typeof d !== 'object') return undefined;
  const text = adfToMarkdown(d as Parameters<typeof adfToMarkdown>[0]);
  return text === '' ? undefined : text;
}

export function ticketFromJiraIssue(issue: JiraIssue, tracker: Tracker): Ticket | null {
  const n = issueNumber(issue.key);
  if (n === null) return null;
  const ticket: Ticket = {status: jiraStatus(issue, tracker), issue: n};
  if (ticket.status === 'untracked') return ticket;
  const priority = priorityOf(issue, tracker);
  if (priority) ticket.priority = priority;
  const effort = effortOf(issue, tracker);
  if (effort) ticket.effort = effort;
  const body = bodyOf(issue);
  if (body) ticket.body = body;
  if (labelsOf(issue).includes('serial')) ticket.serial = true;
  const ids = blockers(issue, tracker).flatMap(b => {
    const bn = issueNumber(b.key);
    return bn === null ? [] : [ticketId(bn)];
  });
  if (ids.length > 0) ticket.depends_on = ids;
  return ticket;
}

/**
 * Tickets keyed `issue-<n>`, in number order so equal priorities pick the older
 * issue. A blocker the search did not return is kept with the status its link
 * shows, so its dependants can see whether it is done.
 */
export function backlogFromJiraIssues(issues: JiraIssue[], tracker: Tracker): BacklogData {
  const features: Record<string, Ticket> = {};
  const numbered = issues.flatMap(i => {
    const n = issueNumber(i.key);
    return n === null ? [] : [{n, issue: i}];
  });
  numbered.sort((a, b) => a.n - b.n);
  for (const {n, issue} of numbered) {
    const ticket = ticketFromJiraIssue(issue, tracker);
    if (ticket) features[ticketId(n)] = ticket;
  }
  for (const {issue} of numbered) {
    for (const b of blockers(issue, tracker)) {
      const bn = issueNumber(b.key);
      if (bn === null || features[ticketId(bn)]) continue;
      const known = isDone(b.fields?.status) ? 'completed' : 'untracked';
      features[ticketId(bn)] = {status: known, issue: bn};
    }
  }
  return {features, anomalies: []};
}

/** The page of one answer; anything else throws, since an unreadable tracker must never read as an empty backlog. */
export function parseSearchPage(body: string): SearchPage {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error('Jira backlog: the search answer is not JSON');
  }
  const page = json as {issues?: unknown; nextPageToken?: unknown};
  if (!Array.isArray(page.issues)) throw new Error('Jira backlog: the search answer has no issues');
  const token = typeof page.nextPageToken === 'string' && page.nextPageToken !== '' ? page.nextPageToken : undefined;
  return {issues: page.issues as JiraIssue[], nextPageToken: token};
}
