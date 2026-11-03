/**
 * The `pr_body` slot's output contract, as pure functions. Whatever a skill
 * writes for the body, the engine keeps the line that closes the ticket's issue
 * and the review sections the ticket asked for.
 */

export interface PrBodyExpect {
  /** The tracker issue the PR closes; null when the backlog is not GitHub. */
  issue: number | null;
  /** Review section titles the ticket names, such as "Design to review". */
  sections: readonly string[];
}

export interface PrBodyCheck {
  ok: boolean;
  problems: string[];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasSection(body: string, title: string): boolean {
  const heading = new RegExp(`^#{1,6}\\s+${escapeRe(title.trim())}\\s*$`, 'im');
  return heading.test(body);
}

function closesIssue(body: string, issue: number): boolean {
  return new RegExp(`^\\s*closes\\s+#${issue}\\b`, 'im').test(body);
}

export function validatePrBody(body: string, expect: PrBodyExpect): PrBodyCheck {
  const problems: string[] = [];
  if (body.trim() === '') problems.push('the body is empty');
  if (expect.issue !== null && !closesIssue(body, expect.issue)) problems.push(`the body does not carry "Closes #${expect.issue}" on its own line`);
  for (const title of expect.sections) {
    if (title.trim() !== '' && !hasSection(body, title)) problems.push(`the body has no "${title.trim()}" section heading`);
  }
  return {ok: problems.length === 0, problems};
}

/** Appends the closing line when a skill's body left it out. Sections cannot be invented, so they stay problems. */
export function ensureClosesLine(body: string, issue: number | null): string {
  if (issue === null || closesIssue(body, issue)) return body;
  return `${body.replace(/\s+$/, '')}\n\nCloses #${issue}\n`;
}
