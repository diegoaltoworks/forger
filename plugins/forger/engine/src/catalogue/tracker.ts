import type {CommandRunner, Tracker} from '../ports';
import type {TicketFacts} from './catalogue';

/** Facts for the tickets, or null when the tracker cannot be reached (no gh, no token, offline). */
export function trackerFacts(tracker: Tracker, numbers: number[]): TicketFacts | null {
  if (numbers.length === 0) return new Map();
  try {
    return tracker.ticketFacts(numbers);
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
