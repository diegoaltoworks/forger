/**
 * The "Gates green" criterion, decided by the engine from the CI checks on the PR
 * head and not by the verifier model. The verdict's own status is left out of the
 * rollup by the caller. Pure.
 */

import type {Criterion, CheckedEntry} from './verdict';
import {namedChecks} from './pr-checks';

const GATES_GREEN = /^\s*gates\s+green\b(.*)$/i;
const NAMED = /\bincluding\s+(?:the\s+)?(.+?)\s*$/i;

/** True when the criterion is the "Gates green" one, matched by its text. */
export function isGatesGreen(criterion: Criterion): boolean {
  return GATES_GREEN.test(criterion.text);
}

/** The check names a "Gates green including the X job" criterion requires among the successes. */
export function requiredChecks(criterion: Criterion): string[] {
  const tail = GATES_GREEN.exec(criterion.text)?.[1] ?? '';
  const named = NAMED.exec(tail)?.[1];
  if (!named) return [];
  return named
    .split(/\s*,\s*|\s+and\s+/i)
    .map(n => n.replace(/\s+jobs?$/i, '').replace(/^["'`]|["'`.]+$/g, '').trim())
    .filter(Boolean);
}

export type GatesGreen =
  | {state: 'decided'; entry: CheckedEntry}
  /** Checks exist that have not finished, or CI is configured and has not reported. */
  | {state: 'pending'}
  /** The rollup holds no check: the caller runs the gates command. */
  | {state: 'no_ci'};

export function decideGatesGreen(criterion: Criterion, rollup: unknown, ciConfigured: boolean): GatesGreen {
  const checks = namedChecks(rollup);
  if (checks.length === 0) return ciConfigured ? {state: 'pending'} : {state: 'no_ci'};
  const failing = checks.filter(c => c.result === 'failed').map(c => c.name);
  const named = (n: string, c: {name: string}) => c.name.toLowerCase() === n.toLowerCase() || c.name.toLowerCase().endsWith(`/ ${n.toLowerCase()}`);
  const required = requiredChecks(criterion);
  const missing = required.filter(n => !checks.some(c => c.result === 'passed' && named(n, c)));
  if (failing.length > 0) {
    return {state: 'decided', entry: {criterion: criterion.id, verdict: 'not_met', evidence: failing.map(n => ({kind: 'ci', ref: `${n}: failed`}))}};
  }
  if (checks.some(c => c.result === 'pending')) return {state: 'pending'};
  if (missing.length > 0) {
    return {
      state: 'decided',
      entry: {criterion: criterion.id, verdict: 'not_met', evidence: missing.map(n => ({kind: 'ci', ref: `${n}: not among the successful checks`}))},
    };
  }
  return {state: 'decided', entry: {criterion: criterion.id, verdict: 'met', evidence: checks.map(c => ({kind: 'ci', ref: `${c.name}: passed`}))}};
}

/** The entry for a criterion whose checks did not finish within the wait. */
export function stillPending(criterion: Criterion): CheckedEntry {
  return {criterion: criterion.id, verdict: 'cannot_tell', missing: 'pending', evidence: []};
}

/** The entry for a repository without CI, from the gates command's exit. */
export function fromGatesCommand(criterion: Criterion, gates: string, passed: boolean): CheckedEntry {
  return {criterion: criterion.id, verdict: passed ? 'met' : 'not_met', evidence: [{kind: 'command', ref: gates}]};
}
