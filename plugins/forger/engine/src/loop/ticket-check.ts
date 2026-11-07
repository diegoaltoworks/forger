/**
 * Refusing tickets whose criteria cannot be checked, before a worker picks
 * one. A refused ticket leaves the queue as a decline does (`needs-info` on
 * GitHub) with the failing criteria named, but is not a worker's decline, so
 * it never counts toward a halt.
 */

import {existsSync, readFileSync} from 'fs';

import type {WorkloopConfig} from '../config';
import {forgerPath} from '../config';
import type {CommandRunner} from '../ports';
import {defaultGuards, type GuardSources} from './guards';
import {checkTicketCriteria, type CriterionOptions, type TicketCheck} from './criteria';
import {leaveQueue, type DeclineTarget} from './decline-io';

/** The named states of `ui.json`: strings, or objects with a `name`. */
export function uiStatesOf(projectRoot: string): string[] {
  const file = forgerPath(projectRoot, '.forger/ui.json');
  if (!existsSync(file)) return [];
  try {
    const states = (JSON.parse(readFileSync(file, 'utf-8')) as {states?: unknown}).states;
    if (!Array.isArray(states)) return [];
    return states.map(s => (typeof s === 'string' ? s : (s as {name?: unknown})?.name)).filter((s): s is string => typeof s === 'string');
  } catch {
    return [];
  }
}

export function criterionOptions(projectRoot: string, config: WorkloopConfig): CriterionOptions {
  return {subjectiveWords: config.criteria.subjective_words, uiStates: uiStatesOf(projectRoot)};
}

/** The comment detail for a refused ticket; pure. */
export function refusalDetail(check: TicketCheck): string {
  const lines = check.problems.map(p => `- ${p}`);
  return `These acceptance criteria cannot be checked:\n\n${lines.join('\n')}\n\nEach criterion takes one of four forms: a named test that must pass; a command with its expected exit code or output; a number with a unit and a source (a spike's thresholds row, an ADR or a cited reference); a named UI state with its assertions or a screenshot.`;
}

export interface Refusal {
  ticket: string;
  problems: string[];
}

/**
 * Checks each workable ticket's text and takes the failing ones out of the
 * queue. A ticket with no text (a local backlog) is not checked. A tracker
 * failure on one ticket is reported and leaves it queued.
 */
export function refuseUncheckable(
  run: CommandRunner,
  target: DeclineTarget,
  tickets: Array<{id: string; body: string | null}>,
  options: CriterionOptions,
  now: () => string = () => new Date().toISOString()
): {refused: Refusal[]; errors: string[]} {
  const refused: Refusal[] = [];
  const errors: string[] = [];
  for (const t of tickets) {
    if (t.body === null) continue;
    const check = checkTicketCriteria(t.body, options);
    if (check.ok) continue;
    try {
      leaveQueue(run, target, {ticket: t.id, reason: 'unclear', detail: refusalDetail(check), at: now()});
      refused.push({ticket: t.id, problems: check.problems});
    } catch (e) {
      errors.push(`${t.id}: ${(e as Error).message}`);
    }
  }
  return {refused, errors};
}

/** What the installed packs say holds guarantees; each file is absent when its pack is not installed. */
export function guardSourcesOf(projectRoot: string): GuardSources {
  const read = (rel: string): Record<string, unknown> | null => {
    const file = forgerPath(projectRoot, rel);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const testing = read('.forger/testing.json');
  const baseline = testing?.coverage_baseline;
  return {coverageBaseline: typeof baseline === 'string' ? baseline : null, uiInstalled: read('.forger/ui.json') !== null};
}

/** The guard globs in force: the configured ones, else the installed packs' defaults. */
export function guardGlobsOf(projectRoot: string, config: WorkloopConfig): string[] {
  return config.guards ?? defaultGuards(guardSourcesOf(projectRoot));
}

/** The test globs of the testing pack, else the usual test file names. */
export function testGlobsOf(projectRoot: string): string[] {
  const file = forgerPath(projectRoot, '.forger/testing.json');
  try {
    const paths = (JSON.parse(readFileSync(file, 'utf-8')) as {test_paths?: unknown}).test_paths;
    if (Array.isArray(paths) && paths.every(p => typeof p === 'string')) return paths as string[];
  } catch {
    /* no testing pack */
  }
  return ['**/*.test.*', '**/*.spec.*'];
}
