/**
 * What a PR is verified against: a ticket found from the PR, or the criteria in
 * the PR's own body. Pure; `verify.ts` does the reading.
 */

import {parseCriteria, type Criterion} from './verdict';

export type VerifySubject = {kind: 'ticket'; ticket: string} | {kind: 'body'; criteria: Criterion[]};

export interface SubjectInput {
  branch: string;
  body: string;
  ticketNaming: 'closing-reference' | 'backlog-id' | 'key-in-title';
  /** The pull request's title; read first when tickets are named by a key in the title. */
  title?: string;
  /** The ticket number a title's key names, or null. */
  ticketOfTitle?: (title: string) => number | null;
  /** Whether a backlog file has the ticket; only asked on a local or no tracker. */
  inBacklog: (ticket: string) => boolean;
}

const CLOSING = /^\s*(?:closes?|fixes|fixed|resolves?|resolved)\s*:?\s+#(\d+)\b/im;

const ANY_CLOSING = /\b(?:closes?|closed|fix(?:es|ed)?|resolves?|resolved)\s*:?\s+#\d+\b/i;

/** Why a body may not hold a closing reference, or null: where tickets are named by a key in the title, `Closes #n` would close the code host's issue of that number. */
export function closingReferenceRefusal(ticketNaming: SubjectInput['ticketNaming'], body: string): string | null {
  if (ticketNaming !== 'key-in-title') return null;
  const found = ANY_CLOSING.exec(body)?.[0];
  return found ? `the pull request's body holds a closing reference ("${found}"), which would close the code host's issue of that number, not the ticket; remove it and name the ticket by its key at the start of the title` : null;
}

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
  const {branch, body, ticketNaming} = input;
  if (ticketNaming === 'closing-reference' || ticketNaming === 'key-in-title') {
    const refused = closingReferenceRefusal(ticketNaming, body);
    if (refused) throw new Error(refused);
    const keyed = ticketNaming === 'key-in-title' && input.title !== undefined ? input.ticketOfTitle?.(input.title) : null;
    if (keyed) return {kind: 'ticket', ticket: `issue-${keyed}`};
    const closes = ticketNaming === 'closing-reference' ? CLOSING.exec(body)?.[1] : undefined;
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
