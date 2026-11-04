/**
 * What a PR is verified against: a ticket found from the PR, or the criteria in
 * the PR's own body. Pure; `verify.ts` does the reading.
 */

import {parseCriteria, type Criterion} from './verdict';

export type VerifySubject = {kind: 'ticket'; ticket: string} | {kind: 'body'; criteria: Criterion[]};

export interface SubjectInput {
  branch: string;
  body: string;
  trackerKind: 'github' | 'local' | 'none';
  /** Whether a backlog file has the ticket; only asked on a local or no tracker. */
  inBacklog: (ticket: string) => boolean;
}

const CLOSING = /^\s*(?:closes?|fixes|fixed|resolves?|resolved)\s*:?\s+#(\d+)\b/im;

/** The checkbox items under an explicit Acceptance heading; none when the heading is missing. */
export function bodyAcceptance(body: string): Criterion[] {
  if (!/^#{1,6}\s+acceptance\b/im.test(body)) return [];
  return parseCriteria(body);
}

export function noSubjectMessage(branch: string): string {
  return `cannot tell what to verify PR on branch "${branch}": give it a ticket (a "Closes #<n>" line in the body, or a branch named feat/issue-<n>), or put the criteria in the body under an "## Acceptance" heading as checkbox items`;
}

/** Closing reference first, then the branch name, then criteria in the body; throws naming both fixes. */
export function resolveSubject(input: SubjectInput): VerifySubject {
  const {branch, body, trackerKind} = input;
  if (trackerKind === 'github') {
    const closes = CLOSING.exec(body)?.[1];
    if (closes) return {kind: 'ticket', ticket: `issue-${closes}`};
    const issue = /^feat\/(issue-\d+)$/.exec(branch)?.[1];
    if (issue) return {kind: 'ticket', ticket: issue};
  } else {
    const id = /^feat\/(.+)$/.exec(branch)?.[1];
    if (id && input.inBacklog(id)) return {kind: 'ticket', ticket: id};
  }
  const criteria = bodyAcceptance(body);
  if (criteria.length > 0) return {kind: 'body', criteria};
  throw new Error(noSubjectMessage(branch));
}
