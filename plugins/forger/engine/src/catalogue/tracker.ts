/**
 * The tracker's facts about the catalogue's fix tickets, read from GitHub in
 * one GraphQL call. A ticket counts as fixed only when a merged PR closed it:
 * one closed as not planned, or by hand, is not.
 */

import type {CommandRunner} from '../ports';
import type {TicketFact, TicketFacts} from './catalogue';

interface IssueNode {
  state?: string;
  timelineItems?: {nodes?: Array<{closer?: {__typename?: string; number?: number; merged?: boolean} | null}>};
}

export function factsQuery(numbers: number[]): string {
  const field = (n: number): string =>
    `i${n}: issue(number: ${n}) { state timelineItems(itemTypes: [CLOSED_EVENT], last: 1) { nodes { ... on ClosedEvent { closer { __typename ... on PullRequest { number merged } } } } } }`;
  return `query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { ${numbers.map(field).join(' ')} } }`;
}

export function factFromIssue(issue: IssueNode): TicketFact {
  const events = issue.timelineItems?.nodes ?? [];
  const closer = events[events.length - 1]?.closer;
  const merged = issue.state === 'CLOSED' && closer?.__typename === 'PullRequest' && closer.merged === true;
  return {closed: issue.state === 'CLOSED', mergedPr: merged && typeof closer?.number === 'number' ? closer.number : null};
}

export function parseFacts(raw: string): TicketFacts {
  const repo = (JSON.parse(raw) as {data?: {repository?: Record<string, IssueNode | null>}}).data?.repository;
  if (!repo) throw new Error('catalogue: the tracker returned no repository');
  const facts = new Map<number, TicketFact>();
  for (const [key, issue] of Object.entries(repo)) if (issue) facts.set(Number(key.slice(1)), factFromIssue(issue));
  return facts;
}

/** Facts for the tickets, or null when the tracker cannot be reached (no gh, no token, offline). */
export function trackerFacts(run: CommandRunner, numbers: number[]): TicketFacts | null {
  if (numbers.length === 0) return new Map();
  const query = `'${factsQuery(numbers).replace(/'/g, `'\\''`)}'`;
  try {
    return parseFacts(run(`gh api graphql -F owner='{owner}' -F repo='{repo}' -f query=${query}`));
  } catch {
    return null;
  }
}

/**
 * The ticket the checked-out branch works (`feat/issue-<n>`), or null off a ticket branch or outside git.
 * A detached head (the verifier checks a PR out that way) is read as the branch of the open PR with that head.
 */
export function branchTicket(run: CommandRunner): number | null {
  try {
    let branch = run('git branch --show-current').trim();
    if (branch === '') {
      const sha = run('git rev-parse HEAD').trim();
      branch = run(`gh pr list --state open --json headRefName,headRefOid --jq '.[] | select(.headRefOid == "${sha}") | .headRefName'`).trim().split('\n')[0] ?? '';
    }
    const m = /^feat\/issue-(\d+)$/.exec(branch);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** The open PR of the checked-out branch (found by head commit when detached), or null when it has none or gh cannot say. */
export function branchPr(run: CommandRunner): number | null {
  try {
    const branch = run('git branch --show-current').trim();
    const sha = run('git rev-parse HEAD').trim();
    const prs = JSON.parse(run('gh pr list --state open --json number,headRefName,headRefOid')) as Array<{number: number; headRefName: string; headRefOid: string}>;
    const pr = prs.find(p => (branch === '' ? p.headRefOid === sha : p.headRefName === branch));
    return pr ? pr.number : null;
  } catch {
    return null;
  }
}
