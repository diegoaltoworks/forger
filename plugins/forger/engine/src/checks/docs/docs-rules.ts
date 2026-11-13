/**
 * The writing rules as pure functions (principle 7): ASCII punctuation only,
 * nothing personal, nothing on the denylist. Each rule maps one line of text to
 * the violations on it; file reading and the exit code live in docs-check.ts.
 */

import type {Finding} from '../waivers';

export type RuleName = 'non-ascii' | 'email' | 'home-path' | 'denylist' | 'third-party-skills' | 'model-agnostic' | 'raw-merge';

export interface Violation {
  file: string;
  line: number;
  rule: RuleName;
  /** The opinion this violation enforces, so a waiver can match it. */
  opinion: string;
  detail: string;
}

/** The opinion id each rule enforces; these are declared by the base pack. */
export const RULE_OPINION: Record<RuleName, string> = {
  'non-ascii': 'base.ascii-punctuation',
  email: 'base.nothing-personal',
  'home-path': 'base.nothing-personal',
  denylist: 'base.nothing-personal',
  'third-party-skills': 'base.no-hard-coded-skills',
  'model-agnostic': 'base.model-agnostic',
  'raw-merge': 'base.merge-through-tool',
};

type LineRule = (line: string) => string[];

const NON_ASCII = /[^\x00-\x7F]/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const HOME_PATH = /(?:\/home\/|\/Users\/)[A-Za-z0-9._-]+/g;

const THIRD_PARTY_SKILLS =
  /matt-?\s?pocock|\bSkill(?: tool)? with\s+["'`][\w:-]+["'`]|docs\/agents\/issue-tracker\.md|(?<![\w/])\/(?:to-tickets|triage)\b/gi;

/**
 * Instruction prose: what the loop executes. It reaches a skill only through a
 * slot (`skills --json`). READMEs, docs and presets may name skills as examples.
 */
const SHIPPED = [/^plugins\/forger\/commands\//, /^plugins\/forger\/templates\//, /^plugins\/forger\/packs\//];

export function isShipped(file: string): boolean {
  return SHIPPED.some(r => r.test(file));
}

/**
 * Prose outside these files names roles, not models or vendors. The adapter
 * docs are where a harness and its models are named once, honestly; the install
 * path is one, since it is a harness's own commands, and so is a collection's page,
 * since its install differs per harness. A decision record about harnesses has "harness" in its name
 * and names them for the same reason.
 */
const ADAPTER_DOCS = [/^README\.md$/, /^docs\/getting-started\.md$/, /^docs\/reference\/[^/]+\.md$/, /(^|\/)adapters\/README\.md$/, /^docs\/skills\/[^/]+\.md$/, /^docs\/adr\/[^/]*harness[^/]*\.md$/];

export function isAdapterDoc(file: string): boolean {
  return ADAPTER_DOCS.some(r => r.test(file));
}

/**
 * A command file is a worker's instructions. A merge it spells out with `gh`
 * runs on the worker's reading of CI; `merge --pr` waits for the checks and
 * refuses a red PR, so a command merges only through that tool.
 */
const COMMAND_FILE = /(^|\/)commands\/[^/]+\.md$/;
const RAW_MERGE = /\bgh\s+pr\s+merge\b/g;

export function isCommandFile(file: string): boolean {
  return COMMAND_FILE.test(file);
}

const rawMerge: LineRule = line => (line.match(RAW_MERGE) ?? []).map(() => 'raw `gh pr merge`; merge through `work.ts merge --pr <n>`, which waits for CI and refuses red');

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole-word, case-insensitive match of a model or vendor name. A name inside a
 * path or a dotted/dashed identifier (`.forger/`, `some-claude-thing`) is not prose.
 */
export function modelNames(names: string[]): LineRule {
  if (names.length === 0) return () => [];
  const re = new RegExp(`(?<![A-Za-z0-9_./-])(?:${names.map(escapeRegExp).join('|')})(?![A-Za-z0-9_/-])`, 'gi');
  return line => line.match(re) ?? [];
}

function codePoint(ch: string): string {
  return 'U+' + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
}

/** The one emoji a section heading may lead with; it marks the section and is allowed nowhere else. */
const HEADING_EMOJI = /^(#{2,6}\s+)\p{Extended_Pictographic}\uFE0F?(?=\s)/u;

export const nonAscii: LineRule = line =>
  [...new Set(line.replace(HEADING_EMOJI, '$1').match(NON_ASCII) ?? [])].map(codePoint);

/** RFC 2606 and RFC 6761: hosts that can never be a real person's mailbox. */
const RESERVED_HOST = /(?:^|\.)(?:example\.(?:com|net|org)|[^.]+\.(?:test|example|invalid|localhost)|(?:test|example|invalid|localhost))$/i;

export const email: LineRule = line =>
  (line.match(EMAIL) ?? []).filter(address => !RESERVED_HOST.test(address.slice(address.lastIndexOf('@') + 1)));

export const homePath: LineRule = line => line.match(HOME_PATH) ?? [];

/** Terms match case-insensitively; blank lines and `#` comments are not terms. */
export function parseDenylist(text: string): string[] {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l !== '' && !l.startsWith('#'));
}

/** Instruction prose never hard-codes a skill call or names a skill collection. */
export const thirdPartySkills: LineRule = line => line.match(THIRD_PARTY_SKILLS) ?? [];

export function denylist(terms: string[]): LineRule {
  const lowered = terms.map(t => t.toLowerCase());
  return line => {
    const hay = line.toLowerCase();
    return terms.filter((_, i) => hay.includes(lowered[i]));
  };
}

/** Every violation in one file's text, in line order. */
export function checkText(file: string, text: string, terms: string[] = [], names: string[] = []): Violation[] {
  const rules: Array<[RuleName, LineRule]> = [
    ['non-ascii', nonAscii],
    ['email', email],
    ['home-path', homePath],
    ['denylist', denylist(terms)],
  ];
  if (isShipped(file)) rules.push(['third-party-skills', thirdPartySkills]);
  if (isCommandFile(file)) rules.push(['raw-merge', rawMerge]);
  if (file.endsWith('.md') && !isAdapterDoc(file)) rules.push(['model-agnostic', modelNames(names)]);
  const out: Violation[] = [];
  text.split('\n').forEach((line, i) => {
    for (const [rule, fn] of rules) {
      for (const detail of fn(line)) out.push({file, line: i + 1, rule, opinion: RULE_OPINION[rule], detail});
    }
  });
  return out;
}

export function formatViolations(violations: Array<Pick<Finding, 'file' | 'line' | 'rule' | 'detail'>>, check = 'docs'): string {
  if (violations.length === 0) return `${check} check: clean`;
  return violations.map(v => `${v.file}:${v.line}: ${v.rule}: ${v.detail}`).join('\n');
}
