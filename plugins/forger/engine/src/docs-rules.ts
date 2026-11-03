/**
 * The writing rules as pure functions (principle 7): ASCII punctuation only,
 * nothing personal, nothing on the denylist. Each rule maps one line of text to
 * the violations on it; file reading and the exit code live in docs-check.ts.
 */

export type RuleName = 'non-ascii' | 'email' | 'home-path' | 'denylist' | 'third-party-skills';

export interface Violation {
  file: string;
  line: number;
  rule: RuleName;
  detail: string;
}

type LineRule = (line: string) => string[];

const NON_ASCII = /[^\x00-\x7F]/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const HOME_PATH = /(?:\/home\/|\/Users\/)[A-Za-z0-9._-]+/g;

const THIRD_PARTY_SKILLS =
  /matt-?\s?pocock|\bSkill tool\b|\bcall(?:s|ed)? the Skill\b|docs\/agents\/issue-tracker\.md|(?<![\w/])\/(?:to-tickets|triage)\b/gi;

/** Shipped prose: what a project adopts or reads as instructions. */
const SHIPPED = [/^plugins\/forger\/commands\//, /^plugins\/forger\/templates\//, /(^|\/)README\.md$/];

export function isShipped(file: string): boolean {
  return SHIPPED.some(r => r.test(file));
}

function codePoint(ch: string): string {
  return 'U+' + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
}

export const nonAscii: LineRule = line =>
  [...new Set(line.match(NON_ASCII) ?? [])].map(codePoint);

export const email: LineRule = line => line.match(EMAIL) ?? [];

export const homePath: LineRule = line => line.match(HOME_PATH) ?? [];

/** Terms match case-insensitively; blank lines and `#` comments are not terms. */
export function parseDenylist(text: string): string[] {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l !== '' && !l.startsWith('#'));
}

/** Forger carries its own steps: shipped prose never hooks another skill collection. */
export const thirdPartySkills: LineRule = line => line.match(THIRD_PARTY_SKILLS) ?? [];

export function denylist(terms: string[]): LineRule {
  const lowered = terms.map(t => t.toLowerCase());
  return line => {
    const hay = line.toLowerCase();
    return terms.filter((_, i) => hay.includes(lowered[i]));
  };
}

/** Every violation in one file's text, in line order. */
export function checkText(file: string, text: string, terms: string[] = []): Violation[] {
  const rules: Array<[RuleName, LineRule]> = [
    ['non-ascii', nonAscii],
    ['email', email],
    ['home-path', homePath],
    ['denylist', denylist(terms)],
  ];
  if (isShipped(file)) rules.push(['third-party-skills', thirdPartySkills]);
  const out: Violation[] = [];
  text.split('\n').forEach((line, i) => {
    for (const [rule, fn] of rules) {
      for (const detail of fn(line)) out.push({file, line: i + 1, rule, detail});
    }
  });
  return out;
}

export function formatViolations(violations: Violation[]): string {
  if (violations.length === 0) return 'docs check: clean';
  return violations.map(v => `${v.file}:${v.line}: ${v.rule}: ${v.detail}`).join('\n');
}
