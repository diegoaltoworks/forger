/**
 * What a critique decides, as pure functions: whether a change is one the
 * audience sees, which brief text the critic is held to, which findings become
 * tickets, and how a finding reads as a ticket.
 */

import {globToRegExp} from '../checks';
import {CRITIQUE_SEVERITIES} from '../pipeline';

export type Severity = (typeof CRITIQUE_SEVERITIES)[number];

export interface Dimension {
  name: string;
  score: number;
  reason: string;
}

export interface Finding {
  severity: Severity;
  dimension: string;
  title: string;
  body: string;
  evidence: string;
}

/** The result a critique leaves (the `critique` contract). */
export interface Critique {
  dimensions: Dimension[];
  findings: Finding[];
}

export const DEFAULT_THRESHOLD: Severity = 'medium';

/** Globs that count as what the audience sees besides the project's UI paths: the captures themselves. */
export const CAPTURE_GLOBS = ['docs/screenshots/**'];

/** Whether the change touches a path the audience sees. */
export function isVisualChange(changed: string[], globs: string[]): boolean {
  const res = [...globs, ...CAPTURE_GLOBS].map(globToRegExp);
  return changed.some(p => res.some(re => re.test(p)));
}

export function isSeverity(s: string): s is Severity {
  return (CRITIQUE_SEVERITIES as readonly string[]).includes(s);
}

/** Findings at or above the threshold are filed; the rest are reported. Order is kept. */
export function splitFindings(findings: Finding[], threshold: Severity): {file: Finding[]; report: Finding[]} {
  const limit = CRITIQUE_SEVERITIES.indexOf(threshold);
  const file: Finding[] = [];
  const report: Finding[] = [];
  for (const f of findings) (CRITIQUE_SEVERITIES.indexOf(f.severity) <= limit ? file : report).push(f);
  return {file, report};
}

const section = (markdown: string, heading: string): string | null => {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex(l => new RegExp(`^##\\s+${heading}\\s*$`, 'i').test(l));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(l => /^#{1,2}\s/.test(l));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
  // The template's placeholder is a prompt to the planner, not a brief.
  return body === '' || /^<[^>]*>$/s.test(body) ? null : body;
};

export interface BriefText {
  brief: string;
  references: string | null;
}

/** The verbatim brief and the reading of the references, from a plan doc; null when the doc holds no brief. */
export function briefFrom(planDoc: string): BriefText | null {
  const brief = section(planDoc, 'Brief, verbatim');
  return brief === null ? null : {brief, references: section(planDoc, 'Interpretation of references')};
}

/** A finding as the ticket the tracker gets. */
export function ticketFor(f: Finding, pr: number): {title: string; body: string} {
  return {
    title: f.title.trim(),
    body: [
      f.body.trim(),
      '',
      `Found by the critique of PR #${pr} on ${f.dimension} (${f.severity}); evidence: \`${f.evidence}\`.`,
    ].join('\n'),
  };
}

export interface CritiquePrompt {
  brief: BriefText;
  captures: string[];
  /** Appended after the contract: the contract's suffix, and any problems a previous attempt had. */
  suffix: string;
  problems?: string[];
}

/** What the critic is given: the brief verbatim, the references, the captures to look at. Never the worker's claims. */
export function buildCritiqueInput(p: CritiquePrompt): string {
  return [
    '## Brief, verbatim',
    p.brief.brief,
    ...(p.brief.references ? ['', '## Interpretation of references', p.brief.references] : []),
    '',
    '## Captures to look at',
    ...p.captures.map(c => `- ${c}`),
    ...(p.problems && p.problems.length > 0 ? ['', 'Your previous answer broke the contract:', ...p.problems.map(x => `- ${x}`)] : []),
    '',
    p.suffix,
  ].join('\n');
}
