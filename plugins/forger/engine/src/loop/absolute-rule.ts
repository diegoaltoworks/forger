/**
 * A design rule stated as an absolute ("never shrinks", "always one line")
 * is a claim about space, so the ticket should carry the measured worst case.
 * Pure; the check only warns.
 */

const ABSOLUTE = /\b(never (?:shrinks?|wraps?|truncates?|clips?|overflows?|scrolls?)|always (?:on )?one line|always (?:fits?|visible|the same)|same (?:size|width|height) everywhere|same everywhere)\b/i;
const MEASURED = /\bmeasure\b[\s\S]*\b\d+(?:\.\d+)?\s?(?:px|ch|em|rem|%)/i;

/** The rule's own words when the ticket states one, else null. */
export function absoluteRuleIn(body: string): string | null {
  return ABSOLUTE.exec(body)?.[0] ?? null;
}

export function carriesMeasurement(body: string): boolean {
  return MEASURED.test(body);
}

/** The warning for a ticket with UI states that states an absolute rule and no measured number; else none. */
export function absoluteRuleWarnings(body: string, uiStates: string[]): string[] {
  const hasStates = /^#{1,6}\s*(?:ui )?states\b/im.test(body) || uiStates.some(s => body.includes(s));
  const rule = absoluteRuleIn(body);
  if (!hasStates || rule === null || carriesMeasurement(body)) return [];
  return [`states the UI rule "${rule}" with no measured number; run \`measure <route-or-state> <selector>\` and put the worst case in the ticket`];
}
