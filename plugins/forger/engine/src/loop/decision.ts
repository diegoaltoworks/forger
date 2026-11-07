/**
 * The owner's answers to a ticket, kept in the ticket's own body so the next
 * worker reads them. Pure over text; the command reads and writes the issue.
 */

import type {TerminalEvent} from './events';

export const DECISIONS_HEADING = '## Decisions';

/** An empty section reads "none" (the ticket template); the first entry replaces it. */
const NONE = /^\s*none\s*$/i;

export function decisionEntry(text: string, login: string, date: string): string {
  const lines = text.trim().split('\n');
  const [first, ...rest] = lines;
  return [`- ${date}, ${login}: ${first}`, ...rest.map(l => `  ${l}`)].join('\n');
}

/** The body with the entry appended under `## Decisions`, creating the section when missing. */
export function appendDecision(body: string, entry: string): string {
  const lines = body.replace(/\s+$/, '').split('\n');
  const start = lines.findIndex(l => l.trim() === DECISIONS_HEADING);
  if (start === -1) return `${lines.join('\n').trimEnd()}\n\n${DECISIONS_HEADING}\n\n${entry}\n`;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const section = lines.slice(start + 1, end).filter((l, i, all) => !(NONE.test(l) && all.every(x => x.trim() === '' || NONE.test(x))));
  const kept = section.join('\n').trim();
  const rebuilt = [DECISIONS_HEADING, '', kept === '' ? entry : `${kept}\n${entry}`, ''];
  const after = lines.slice(end);
  return [...lines.slice(0, start), ...rebuilt, ...(after.length > 0 ? [...after, ''] : [])].join('\n');
}

/** True when the standing halt is on this issue's ticket. */
export function haltedOnIssue(halt: TerminalEvent | null, issue: number): boolean {
  return halt !== null && halt.ticket === `issue-${issue}`;
}
