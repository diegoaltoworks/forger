/** The GraphQL calls of the GitHub tracker, and the parsers of their answers; pure. */

import type {OpenTicket, TicketFact, TicketLinks} from '../ports';
import {quote} from './quote';

const OPEN_TICKETS_QUERY = 'query($owner:String!,$repo:String!,$label:String!){repository(owner:$owner,name:$repo){issues(first:100,states:OPEN,labels:[$label]){nodes{number body blockedBy(first:50){nodes{number}}}}}}';

/** The gh call for the open tickets; gh fills {owner} and {repo} only in field values, never inside the query text. */
export function openTicketsCommand(label: string): string {
  return `gh api graphql -F owner='{owner}' -F repo='{repo}' -f label=${quote(label)} -f query=${quote(OPEN_TICKETS_QUERY)}`;
}

/** The open tickets of the answer to `openTicketsCommand`. */
export function parseOpenTickets(raw: string): OpenTicket[] {
  const nodes = (JSON.parse(raw) as {data: {repository: {issues: {nodes: Array<{number: number; body: string; blockedBy?: {nodes: Array<{number: number}>}}>}}}}).data.repository.issues.nodes;
  return nodes.map(n => ({number: n.number, body: n.body ?? '', native: (n.blockedBy?.nodes ?? []).map(b => b.number)}));
}

export const ISSUE_LINKS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) { id body blockedBy(first: 50) { nodes { number } } }
  }
}`;

export const ADD_BLOCKED_BY = `mutation($issue: ID!, $blocker: ID!) {
  addBlockedBy(input: {issueId: $issue, blockingIssueId: $blocker}) { clientMutationId }
}`;

export function ticketLinksCommand(ticket: number): string {
  return ['gh api graphql', `-F owner='{owner}' -F repo='{repo}' -F number=${ticket}`, `-f query=${quote(ISSUE_LINKS_QUERY)}`].join(' ');
}

export function blockCommand(blocked: string, blocker: string): string {
  return ['gh api graphql', `-f query=${quote(ADD_BLOCKED_BY)}`, `-f issue=${quote(blocked)} -f blocker=${quote(blocker)}`].join(' ');
}

/** The answer to `ticketLinksCommand`: null when the ticket does not exist; throws when the answer is not JSON. */
export function parseTicketLinks(raw: string, ticket: number): TicketLinks | null {
  let node: {id?: string; body?: string; blockedBy?: {nodes?: Array<{number: number}>}} | null | undefined;
  try {
    node = JSON.parse(raw)?.data?.repository?.issue;
  } catch {
    throw new Error(`link-blockers: gh returned invalid JSON for #${ticket}`);
  }
  if (!node?.id) return null;
  return {ref: node.id, body: node.body ?? '', native: (node.blockedBy?.nodes ?? []).map(n => n.number)};
}

interface IssueNode {
  state?: string;
  timelineItems?: {nodes?: Array<{closer?: {__typename?: string; number?: number; merged?: boolean} | null}>};
}

export function factsQuery(numbers: number[]): string {
  const field = (n: number): string =>
    `i${n}: issue(number: ${n}) { state timelineItems(itemTypes: [CLOSED_EVENT], last: 1) { nodes { ... on ClosedEvent { closer { __typename ... on PullRequest { number merged } } } } } }`;
  return `query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { ${numbers.map(field).join(' ')} } }`;
}

export function factsCommand(numbers: number[]): string {
  return `gh api graphql -F owner='{owner}' -F repo='{repo}' -f query=${quote(factsQuery(numbers))}`;
}

export function factFromIssue(issue: IssueNode): TicketFact {
  const events = issue.timelineItems?.nodes ?? [];
  const closer = events[events.length - 1]?.closer;
  const merged = issue.state === 'CLOSED' && closer?.__typename === 'PullRequest' && closer.merged === true;
  return {closed: issue.state === 'CLOSED', mergedPr: merged && typeof closer?.number === 'number' ? closer.number : null};
}

export function parseFacts(raw: string): Map<number, TicketFact> {
  const repo = (JSON.parse(raw) as {data?: {repository?: Record<string, IssueNode | null>}}).data?.repository;
  if (!repo) throw new Error('catalogue: the tracker returned no repository');
  const facts = new Map<number, TicketFact>();
  for (const [key, issue] of Object.entries(repo)) if (issue) facts.set(Number(key.slice(1)), factFromIssue(issue));
  return facts;
}
