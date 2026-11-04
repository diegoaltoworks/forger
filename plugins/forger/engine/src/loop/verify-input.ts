/**
 * What the verifier is given and how its answer is read (ADR 0010). The input
 * is built from the criteria, the diff and the gate result and from nothing
 * else: the worker's transcript, the PR body and the commit messages are the
 * worker's claims, so this function has no parameter that could carry them.
 * Pure: whether evidence resolves is a predicate the caller passes in.
 */

import type {Tier, WorkloopConfig} from '../config';
import {checkVerdict, reduceVerdict, type CheckedEntry, type Criterion, type Decision, type Evidence, type VerdictEntry} from './verdict';
import type {ChecksConclusion} from './pr-checks';

export interface GateResult {
  checks: ChecksConclusion | 'unknown';
  failing_checks: string[];
}

export interface VerifierInput {
  criteria: Criterion[];
  diff: string;
  gate: GateResult;
  /** Images the PR changed under docs/screenshots/; empty when it changed none. */
  screenshots?: string[];
}

export function buildVerifierInput(input: VerifierInput): string {
  const criteria = input.criteria.map(c => `- ${c.id}: ${c.text}${c.ui ? ' (UI state)' : ''}`).join('\n');
  const shots = input.screenshots ?? [];
  const gate =
    input.gate.checks === 'failure'
      ? `failure (${input.gate.failing_checks.join(', ') || 'unnamed'})`
      : input.gate.checks;
  return [
    'You are the verifier. Decide, for each acceptance criterion below, whether the built result in the current directory meets it.',
    'The current directory is a read-only checkout of the change. Do not edit anything.',
    'For each criterion answer "met", "not_met" or "cannot_tell". "met" and "not_met" need evidence: a file with line (kind "file", ref "path:line"), a command you ran (kind "command"), or a test name (kind "test"). If you cannot tell, say cannot_tell; do not guess.',
    'Reply with one JSON object and nothing after it: {"verdict":[{"criterion":"c1","verdict":"met","evidence":[{"kind":"file","ref":"src/a.ts:10"}]}]}. Judge every criterion exactly once, using the ids below.',
    ...(shots.length > 0
      ? [
          'The change includes screenshots. Open each one and look at it. Judge a UI state, and any criterion about what is visible, from the image itself: if the image shows a defect (a banner or button that should not be there, text with a missing value, content that is absent), the answer is "not_met". Cite the image as evidence of kind "screenshot", ref the path. A UI state that no screenshot shows is "cannot_tell", never "met".',
          '',
          '## Changed screenshots',
          ...shots.map(s => `- ${s}`),
        ]
      : []),
    '',
    '## Acceptance criteria',
    criteria,
    '',
    `## Gate result for the head commit: ${gate}`,
    '',
    '## Diff against the base',
    input.diff,
  ].join('\n');
}

/**
 * The tier the verifier runs on: the configured one, else the first priority
 * tier whose model differs from the default (worker) tier's, else the default.
 */
export function verifierTier(config: Pick<WorkloopConfig, 'verifier' | 'model_by_priority'>): Tier {
  if (config.verifier) return config.verifier;
  const worker = config.model_by_priority.default;
  const other = Object.values(config.model_by_priority).find(t => t.model !== worker.model);
  return other ?? worker;
}

/** The JSON object in the verifier's reply: the whole text, a fenced block, or the outermost braces. */
export function extractVerdict(output: string): VerdictEntry[] | null {
  const text = output.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/g;
  const candidates = [text, ...[...text.matchAll(fenced)].map(m => m[1].trim())];
  const open = text.indexOf('{');
  const close = text.lastIndexOf('}');
  if (open >= 0 && close > open) candidates.push(text.slice(open, close + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as {verdict?: unknown};
      if (parsed && Array.isArray(parsed.verdict)) return parsed.verdict as VerdictEntry[];
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export interface VerdictRecord {
  pr: number;
  /** The head commit verified; a later push makes the record stale. */
  head: string;
  ticket: string;
  verifier: string;
  decision: Decision;
  entries: CheckedEntry[];
  /** Why the output was rejected; empty when it was valid. */
  problems: string[];
  at: string;
}

export interface RecordSubject {
  pr: number;
  head: string;
  ticket: string;
  verifier: string;
  at: string;
}

/**
 * Valid output is recorded as judged (unresolvable `met` demoted). Output that
 * cannot be read, or breaks the validator's rules, is recorded as `cannot_tell`
 * for every criterion, so it blocks and is never passed on trust.
 */
export function recordVerdict(
  subject: RecordSubject,
  criteria: Criterion[],
  output: string,
  resolves: (e: Evidence) => boolean,
): VerdictRecord {
  const verdict = extractVerdict(output);
  const checked = verdict ? checkVerdict(criteria, verdict, resolves) : null;
  const problems = verdict ? checked!.problems : ['the verifier output holds no JSON verdict'];
  const entries: CheckedEntry[] =
    checked && problems.length === 0
      ? checked.entries
      : criteria.map(c => ({criterion: c.id, verdict: 'cannot_tell', evidence: [], demoted: 'the verifier output was invalid'}));
  return {...subject, decision: reduceVerdict(entries), entries, problems};
}
