/**
 * Linking what an issue's `Blocked by` section names as native blocked-by
 * dependencies, so intake never leaves a dependency written only in prose.
 * Every tracker call goes through the injected runner.
 */

import type {CommandRunner} from '../ports';
import {blockersToLink, parseBlockedBy} from './blocked-by';

export interface LinkResult {
  issue: number;
  linked: number[];
  already: number[];
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export const ISSUE_LINKS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) { id body blockedBy(first: 50) { nodes { number } } }
  }
}`;

export const ADD_BLOCKED_BY = `mutation($issue: ID!, $blocker: ID!) {
  addBlockedBy(input: {issueId: $issue, blockingIssueId: $blocker}) { clientMutationId }
}`;

interface IssueLinks {
  id: string;
  body: string;
  native: number[];
}

function readIssue(run: CommandRunner, issue: number): IssueLinks {
  const raw = run(
    [
      'gh api graphql',
      `-F owner='{owner}' -F repo='{repo}' -F number=${issue}`,
      `-f query=${shellQuote(ISSUE_LINKS_QUERY)}`,
    ].join(' ')
  );
  let node: {id?: string; body?: string; blockedBy?: {nodes?: Array<{number: number}>}} | null | undefined;
  try {
    node = JSON.parse(raw)?.data?.repository?.issue;
  } catch {
    throw new Error(`link-blockers: gh returned invalid JSON for #${issue}`);
  }
  if (!node?.id) throw new Error(`link-blockers: issue #${issue} was not found`);
  return {id: node.id, body: node.body ?? '', native: (node.blockedBy?.nodes ?? []).map(n => n.number)};
}

/** Links every issue under the issue's `Blocked by` heading that is not already linked. */
export function linkBlockers(run: CommandRunner, issue: number): LinkResult {
  const me = readIssue(run, issue);
  const declared = parseBlockedBy(me.body);
  const todo = blockersToLink(issue, declared, me.native);
  const linked: number[] = [];
  for (const blocker of todo) {
    const other = readIssue(run, blocker);
    run(
      [
        'gh api graphql',
        `-f query=${shellQuote(ADD_BLOCKED_BY)}`,
        `-f issue=${shellQuote(me.id)} -f blocker=${shellQuote(other.id)}`,
      ].join(' ')
    );
    linked.push(blocker);
  }
  return {issue, linked, already: declared.filter(n => n !== issue && me.native.includes(n))};
}
