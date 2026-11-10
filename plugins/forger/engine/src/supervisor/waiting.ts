/**
 * What waits on the owner, and what merged in the period being reported. Pure
 * over issues, ADR texts and merged PRs the CLI read from the tracker and the
 * checkout; no I/O.
 */

import type {TerminalEvent} from '../loop';
import {failedDeliveries, reasonSummary, uncausedClears} from '../loop';
import type {OwnerItem} from './supervisor';

/** Issue labels that park a ticket until the owner decides. */
export const OWNER_LABELS: readonly string[] = ['needs-info', 'needs-human', 'needs-triage'];

export interface WaitingIssue {
  number: number;
  title: string;
  labels: string[];
  body: string;
}

export interface AdrText {
  /** File name, such as `0007-some-decision.md`. */
  name: string;
  text: string;
}

export interface MergedPrFact {
  number: number;
  title: string;
  /** ISO time the PR merged. */
  mergedAt: string;
}

/**
 * The recommendation a text states: the first paragraph under a
 * "Recommendation" heading, else the first line that says "I recommend" or
 * starts "Recommendation:". Null when it makes none.
 */
export function recommendationFrom(text: string): string | null {
  const lines = text.split('\n');
  const heading = lines.findIndex(l => /^#{1,6}\s+recommend/i.test(l.trim()));
  if (heading >= 0) {
    const found = leadingText(lines.slice(heading + 1));
    if (found !== null) return found;
  }
  const at = lines.findIndex(l => /^\W*(?:\*\*)?recommendations?(?:\*\*)?\s*[:-]/i.test(l.trim()) || /\bI recommend\b/i.test(l));
  if (at < 0) return null;
  return sentence(lines[at].trim().replace(/^\W*(?:\*\*)?recommendations?\s*[:-]?\s*(?:\*\*)?\s*/i, ''));
}

/** The first sentence, without markup or a closing full stop. */
function sentence(text: string): string | null {
  const flat = text.replace(/\*\*/g, '').replace(/^(?:[-*]|\d+\.)\s+/, '').trim();
  const cut = /^(.+?[^.\s])(?:\.\s|\.$|$)/.exec(flat);
  return cut === null ? null : cut[1];
}

/** The first paragraph before the next heading; a lead-in that ends with a colon gives way to the text after it. */
function leadingText(lines: string[]): string | null {
  const paras: string[][] = [];
  let cur: string[] = [];
  for (const l of lines) {
    if (/^#{1,6}\s/.test(l.trim())) break;
    if (l.trim() === '') {
      if (cur.length > 0) paras.push(cur);
      cur = [];
    } else cur.push(l.trim());
  }
  if (cur.length > 0) paras.push(cur);
  for (const p of paras) {
    const joined = p.join(' ');
    if (joined.endsWith(':') || joined.startsWith('|')) continue;
    return sentence(joined);
  }
  return null;
}

function firstLine(text: string): string {
  return text.split('\n').find(l => l.trim() !== '' && !l.startsWith('#'))?.trim() ?? '';
}

/** `setAside` holds the reason the loop recorded for each issue it set aside, by issue number. */
export function waitingIssues(issues: WaitingIssue[], setAside: ReadonlyMap<number, string> = new Map()): OwnerItem[] {
  return issues
    .filter(i => i.labels.some(l => OWNER_LABELS.includes(l)))
    .sort((a, b) => a.number - b.number)
    .map(i => {
      const label = i.labels.find(l => OWNER_LABELS.includes(l)) as string;
      const reason = label === 'needs-human' ? setAside.get(i.number) : undefined;
      return {
        question: `#${i.number} ${i.title} is ${label}`,
        recommendation: recommendationFrom(i.body) ?? 'you decide it, then relabel the issue (its text makes no recommendation)',
        because: reason !== undefined ? `the loop set it aside: ${reasonSummary(reason)}` : label === 'needs-triage' ? 'it was filed as a follow-up and no one has decided to build it' : 'a worker declined or handed it over and only you can unblock it',
      };
    });
}

export interface OwnerReviewPr {
  number: number;
  title: string;
  url: string;
}

/** Open PRs the loop built and verified and left for the owner to merge, oldest first. */
export function ownerReviewPrs(prs: OwnerReviewPr[]): OwnerItem[] {
  return [...prs]
    .sort((a, b) => a.number - b.number)
    .map(p => ({
      question: `PR #${p.number} ${p.title} is waiting for your review: ${p.url}`,
      recommendation: 'review what only you can judge, then merge it; the loop sees the merge and carries on',
      because: 'its ticket says the owner reviews, so the loop built and verified it and left the merge to you',
    }));
}

export function proposedAdrs(adrs: AdrText[]): OwnerItem[] {
  return adrs
    .filter(a => /^status:\s*proposed\b/im.test(a.text))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(a => {
      const title = /^#\s+(.+)$/m.exec(a.text)?.[1] ?? a.name;
      return {
        question: `ADR ${a.name.replace(/\.md$/, '')} is Proposed: ${title}`,
        recommendation: recommendationFrom(a.text) ?? 'you accept or reject it (its text makes no recommendation)',
        because: sentence(firstLine(a.text.replace(/^#.*\n+Status:.*\n+/m, ''))) ?? 'a proposed decision binds nothing until you settle it',
      };
    });
}

export interface Period {
  /** Inclusive start as an ISO time; null reports everything. */
  since: string | null;
  source: 'flag' | 'last_report' | 'none';
}

/** `--since` wins over the time of the last report; neither means the whole history. */
export function reportPeriod(sinceFlag: string | undefined, lastReportAt: string | null): Period {
  if (sinceFlag !== undefined) {
    const t = Date.parse(sinceFlag);
    if (Number.isNaN(t)) throw new Error(`--since must be a date or a time, such as 2026-11-03 or 2026-11-03T08:00:00Z; got "${sinceFlag}"`);
    return {since: new Date(t).toISOString(), source: 'flag'};
  }
  if (lastReportAt !== null && !Number.isNaN(Date.parse(lastReportAt))) return {since: new Date(lastReportAt).toISOString(), source: 'last_report'};
  return {since: null, source: 'none'};
}

/** The PRs merged inside the period, oldest first, as report lines. */
export function mergedInPeriod(prs: MergedPrFact[], period: Period): string[] {
  return prs
    .filter(p => period.since === null || Date.parse(p.mergedAt) >= Date.parse(period.since))
    .sort((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt))
    .map(p => `#${p.number} ${p.title}`);
}

/** Every halt cleared with no cause and no reason: the failure was set aside and nothing says why. */
export function uncausedClearItems(events: TerminalEvent[]): OwnerItem[] {
  return uncausedClears(events).map(e => ({
    question: `A halt was cleared with no reason (${e.at}): ${e.reason ?? 'no error recorded'}`,
    recommendation: 'file the cause as an issue, or record that it was not a defect, so the failure is not lost',
    because: 'the halt label was removed by hand, or resume ran before it needed a reason, so the failure has no recorded cause',
  }));
}

/** Every delivery that failed and that no later delivery has made good: the delivered build may be broken. */
export function failedDeliveryItems(events: TerminalEvent[]): OwnerItem[] {
  return failedDeliveries(events).map(pr => ({
    question: `The delivery after PR #${pr} failed and no later delivery has passed`,
    recommendation: 'fix what the P0 issue it filed describes, or roll the build back by hand if the pack has no rollback',
    because: 'a merged change did not deploy or did not pass its check, so the running build may not be the merged one',
  }));
}
