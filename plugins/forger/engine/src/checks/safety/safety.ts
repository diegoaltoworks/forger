/**
 * `check safety`: data in production is sacred and a secret in the repo is a
 * leak that history keeps. Two rules, both pure over a parsed diff: added lines
 * are matched against known credential shapes (the finding names the file, line
 * and pattern, never the match), and a diff that touches migration or schema
 * paths must also touch a test under the data-test paths.
 */

import type {Gap} from '../gaps';
import {globToRegExp, type Finding} from '../waivers';

export const SAFETY_PATH = '.forger/safety.json';
export const SECRETS_OPINION = 'safety.secrets';
export const DATA_FORWARD_OPINION = 'safety.data-forward';
export const AUDIT_OPINION = 'safety.dependency-audit';

export interface SafetyConfig {
  /** Globs of migrations and stored-shape definitions. */
  migration_paths: string[];
  /** Globs of the tests that prove stored records carry forward. */
  data_test_paths: string[];
  /** The project's own dependency audit; the flags it carries choose the severity it fails at. */
  audit_command?: string;
  /** The periodic access review; absent or 0 is off. */
  access_review?: {every_merged: number};
}

export class SafetyConfigError extends Error {
  constructor(problem: string) {
    super(`${SAFETY_PATH}: ${problem}`);
  }
}

function globs(v: unknown, name: string): string[] {
  if (!Array.isArray(v) || v.some(s => typeof s !== 'string' || s.trim() === '')) {
    throw new SafetyConfigError(`"${name}" must be a list of non-empty globs`);
  }
  return (v as string[]).map(s => s.trim());
}

/** Parsed once at the boundary: a bad shape is an error, never a quiet pass. */
export function parseSafetyConfig(text: string): SafetyConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SafetyConfigError('is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SafetyConfigError('must be an object');
  const obj = raw as Record<string, unknown>;
  const audit = obj.audit_command;
  if (audit !== undefined && (typeof audit !== 'string' || audit.trim() === '')) {
    throw new SafetyConfigError('"audit_command" must be a non-empty command');
  }
  const review = obj.access_review;
  let accessReview: SafetyConfig['access_review'];
  if (review !== undefined) {
    const n = typeof review === 'object' && review !== null ? (review as Record<string, unknown>).every_merged : undefined;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new SafetyConfigError('"access_review.every_merged" must be a whole number, 0 to turn it off');
    accessReview = {every_merged: n};
  }
  return {
    migration_paths: globs(obj.migration_paths, 'migration_paths'),
    data_test_paths: globs(obj.data_test_paths, 'data_test_paths'),
    ...(audit === undefined ? {} : {audit_command: audit.trim()}),
    ...(accessReview === undefined ? {} : {access_review: accessReview}),
  };
}

export interface SecretPattern {
  name: string;
  re: RegExp;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  {name: 'private-key', re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/},
  {name: 'aws-access-key-id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/},
  {name: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/},
  {name: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/},
  {name: 'stripe-live-key', re: /\b[rs]k_live_[0-9A-Za-z]{20,}/},
  {name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/},
  {name: 'api-secret-key', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/},
];

/** Names of the patterns a line matches, in table order. */
export function scanLine(line: string, patterns: SecretPattern[] = SECRET_PATTERNS): string[] {
  return patterns.filter(p => p.re.test(line)).map(p => p.name);
}

export interface AddedLine {
  file: string;
  line: number;
  text: string;
}

/** The added lines of a `git diff -U0` text, with their line numbers in the new file. */
export function parseAddedLines(diff: string): AddedLine[] {
  const out: AddedLine[] = [];
  let file: string | null = null;
  let next = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw === '+++ /dev/null' ? null : raw.replace(/^\+\+\+ (?:b\/)?/, '');
      continue;
    }
    const hunk = /^@@ -\S+ \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (file !== null && raw.startsWith('+')) out.push({file, line: next++, text: raw.slice(1)});
  }
  return out;
}

/** An env file holds real values; the example, sample and template variants are meant to be committed. */
export function isEnvFile(path: string): boolean {
  const name = path.split('/').pop() ?? '';
  if (name !== '.env' && !name.startsWith('.env.')) return false;
  return !/\.(?:example|sample|template|dist)$/.test(name);
}

export function checkSecrets(added: AddedLine[], envFiles: string[], patterns: SecretPattern[] = SECRET_PATTERNS): Finding[] {
  const findings: Finding[] = [];
  for (const path of envFiles) {
    findings.push({file: path, line: 1, rule: 'env-file', opinion: SECRETS_OPINION, detail: 'an env file is added or changed; keep real values out of the repository'});
  }
  for (const a of added) {
    for (const name of scanLine(a.text, patterns)) {
      findings.push({file: a.file, line: a.line, rule: name, opinion: SECRETS_OPINION, detail: `added line matches the ${name} pattern (match not shown)`});
    }
  }
  return findings;
}

/** Paths changed in the diff; a deleted file is not a change that needs carrying forward. */
export function checkDataForward(changedPaths: string[], config: SafetyConfig): Finding[] {
  const migrations = config.migration_paths.map(globToRegExp);
  const tests = config.data_test_paths.map(globToRegExp);
  if (changedPaths.some(p => tests.some(re => re.test(p)))) return [];
  return changedPaths
    .filter(p => migrations.some(re => re.test(p)))
    .map(p => ({
      file: p,
      line: 1,
      rule: 'migration-without-test',
      opinion: DATA_FORWARD_OPINION,
      detail: `a stored shape changed with no new or changed test under ${config.data_test_paths.join(', ')}`,
    }));
}

const EXIT_MARK = 'forger-audit-exit:';
const AUDIT_TAIL_LINES = 15;

/** The audit run through a shell that reports its exit status in the output, since a plain runner cannot tell a failure from silence. */
export function auditShellCommand(command: string): string {
  return `(
${command}
) 2>&1; printf '\\n${EXIT_MARK}%s\\n' "$?"`;
}

/** Exit statuses a shell gives when the command was found but not run (126) or not found (127). */
const NOT_STARTED = new Set([126, 127]);

/** The verdict on the audit's output: a non-zero exit is one finding carrying the end of the output. */
export function judgeAudit(output: string, command: string): Finding[] {
  const finding = (rule: string, detail: string): Finding[] => [{file: SAFETY_PATH, line: 1, rule, opinion: AUDIT_OPINION, detail}];
  const at = output.lastIndexOf(EXIT_MARK);
  if (at < 0) return finding('audit-cannot-start', `the audit command could not be run: ${command}`);
  const code = Number(output.slice(at + EXIT_MARK.length).trim());
  const body = output.slice(0, at).trim();
  const tail = body.split('\n').slice(-AUDIT_TAIL_LINES).join('\n');
  if (NOT_STARTED.has(code)) return finding('audit-cannot-start', `the audit command could not be started (exit ${code}): ${command}${tail ? `\n${tail}` : ''}`);
  if (code === 0) return [];
  return finding('audit-vulnerabilities', `the audit command exited ${code}: ${command}${tail ? `\n${tail}` : ''}`);
}

/** With no audit command the opinion cannot be measured; MAY, so it informs and does not fail. */
export function auditGaps(config: SafetyConfig): Gap[] {
  if (config.audit_command !== undefined) return [];
  return [{file: SAFETY_PATH, opinion: AUDIT_OPINION, modality: 'MAY', detail: 'no audit command configured'}];
}
