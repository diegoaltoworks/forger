/**
 * Open pull requests the loop did not open. They are invisible to a loop that
 * only reads issues, so it builds the same fix a contributor already offered.
 * The decisions here are pure; the gh calls sit in github-backlog.ts.
 */

export interface OpenPr {
  number: number;
  title: string;
  /** Login of the account that opened the PR. */
  author: string;
  /** Issue numbers the PR closes by a closing reference. */
  closes: number[];
}

/** `gh pr list` fields this module reads. */
export const OPEN_PRS_COMMAND = 'gh pr list --state open --limit 100 --json number,title,author,closingIssuesReferences';

export const VIEWER_COMMAND = 'gh api user --jq .login';

export function parseOpenPrs(raw: string): OpenPr[] {
  const list: unknown = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error('expected an array of pull requests');
  return list.map(p => {
    if (typeof (p as {number?: unknown})?.number !== 'number') throw new Error('a pull request has no number');
    const pr = p as {number: number; title?: string; author?: {login?: string}; closingIssuesReferences?: Array<{number: number}>};
    return {
      number: pr.number,
      title: pr.title ?? '',
      author: pr.author?.login ?? '',
      closes: (pr.closingIssuesReferences ?? []).map(r => r.number),
    };
  });
}

/** Open PRs from accounts other than the loop's own. */
export function outsidePrs(prs: OpenPr[], loopLogin: string): OpenPr[] {
  return prs.filter(p => p.author.toLowerCase() !== loopLogin.toLowerCase());
}

/** Whether a PR is about an issue: it closes it, or the title names its number. */
export function referencesIssue(pr: OpenPr, issue: number): boolean {
  return pr.closes.includes(issue) || new RegExp(`(^|[^\\w/])#${issue}(?!\\d)`).test(pr.title);
}

/** The outside PRs that hold an issue. */
export function holdingPrs(prs: OpenPr[], issue: number): number[] {
  return prs.filter(p => referencesIssue(p, issue)).map(p => p.number);
}

export function outsidePrAnomaly(pr: OpenPr): string {
  return `PR #${pr.number} from ${pr.author} is open and the loop did not open it; triage it (docs/04-supervising.md)`;
}
