/**
 * A failed gate is run once more with no change, to name the cause: a pass on the
 * rerun is a flaky gate, recorded and ticketed, and never a pass for the failed run.
 * The decisions are pure; the reruns and the tracker go through the injected runner.
 */

import {existsSync, mkdirSync, writeFileSync} from 'fs';
import {dirname} from 'path';

import type {CommandRunner} from '../ports';

/** The label on the ticket that makes a flaky test deterministic. */
export const FLAKY_GATE_LABEL = 'flaky-gate';

export interface FlakyGate {
  pr: number;
  head: string;
  /** The check that failed and then passed, or the gates command when the repository has no CI. */
  check: string;
  /** The tests the failed job's log names; empty when the log names none. */
  tests: string[];
}

function quote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** The ids of the workflow runs on a head that did not succeed, from `gh run list --json databaseId,conclusion`. */
export function failedRunIds(listJson: string): number[] {
  try {
    const runs = JSON.parse(listJson) as {databaseId?: number; conclusion?: string | null}[];
    return runs.filter(r => typeof r.databaseId === 'number' && ['failure', 'timed_out', 'cancelled', 'startup_failure'].includes(r.conclusion ?? '')).map(r => r.databaseId as number);
  } catch {
    return [];
  }
}

const FAILED_TEST = /^\s*(?:\(fail\)|FAIL)\s+(.+?)(?:\s+\[[\d.]+m?s\])?\s*$/;

/** The failed tests a job log names, in order and once each. */
export function failedTests(log: string): string[] {
  const names: string[] = [];
  for (const line of log.split('\n')) {
    const m = FAILED_TEST.exec(line.replace(/^[^\t]*\t[^\t]*\t/, '').replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s/, ''));
    if (m && !names.includes(m[1])) names.push(m[1]);
  }
  return names.slice(0, 20);
}

/** The head's rerun marker: a head whose failed gate was rerun once is never rerun again. */
export function rerunMarker(dir: string, pr: number, head: string): string {
  return `${dir}/pr-${pr}-${head}.rerun`;
}

export function alreadyRerun(marker: string): boolean {
  return existsSync(marker);
}

export function markRerun(marker: string): void {
  mkdirSync(dirname(marker), {recursive: true});
  writeFileSync(marker, '');
}

export type Rerun = {started: true; tests: string[]} | {started: false; why: string};

/** Names the failed tests from the failed jobs' logs, then starts the failed jobs again on the same head. */
export function rerunFailedJobs(run: CommandRunner, head: string): Rerun {
  let ids: number[];
  try {
    ids = failedRunIds(run(`gh run list --commit ${head} --json databaseId,conclusion --limit 50`));
  } catch (e) {
    return {started: false, why: `the runs on the head could not be listed: ${(e as Error).message}`};
  }
  if (ids.length === 0) return {started: false, why: 'no failed workflow run on the head can be rerun'};
  const tests: string[] = [];
  for (const id of ids) {
    try {
      for (const t of failedTests(run(`gh run view ${id} --log-failed`))) if (!tests.includes(t)) tests.push(t);
    } catch {
      // a log that cannot be read leaves the tests unnamed, never the rerun undone
    }
  }
  for (const id of ids) {
    try {
      run(`gh run rerun ${id} --failed`);
    } catch (e) {
      return {started: false, why: `the rerun of run ${id} could not be started: ${(e as Error).message}`};
    }
  }
  return {started: true, tests};
}

/** The line a `flaky_gate` event carries. */
export function flakyReason(f: FlakyGate): string {
  return `PR #${f.pr}: ${f.check}${f.tests.length > 0 ? ` (${f.tests.join(', ')})` : ''}`;
}

export function flakyTitle(check: string): string {
  return `Make the flaky gate "${check}" deterministic`;
}

function flakyBody(f: FlakyGate): string {
  const named = f.tests.length > 0 ? f.tests.map(t => `- ${t}`).join('\n') : 'The failed job log names no test.';
  return [
    '## What happened',
    '',
    `The gate \`${f.check}\` failed on PR #${f.pr} at \`${f.head.slice(0, 7)}\` and passed when run again with no change.`,
    '',
    '## Failed tests',
    '',
    named,
    '',
    '## What to build',
    '',
    'Find what the failing test depends on that is not under its control (the clock, the order of tests, a shared file, the network, a race) and remove it. Do not skip the test, retry it inside the test tool or mark it as allowed to fail.',
    '',
    '## Acceptance',
    '',
    `- [ ] The cause of the intermittent failure of \`${f.check}\` is removed, and a test pins it`,
    '- [ ] Gates green',
    '',
  ].join('\n');
}

/**
 * Files one ticket for a flaky gate; a later sighting of the same check comments on the open
 * ticket and files nothing. Returns what it did.
 */
export function ticketFlaky(run: CommandRunner, f: FlakyGate, intakeLabel: string): 'filed' | 'commented' {
  const title = flakyTitle(f.check);
  const open = JSON.parse(run(`gh issue list --state open --label ${FLAKY_GATE_LABEL} --search ${quote(`"${title}" in:title`)} --json number,title`)) as {number: number; title: string}[];
  const existing = open.find(i => i.title === title);
  if (existing) {
    const tests = f.tests.length > 0 ? ` Failed tests: ${f.tests.join(', ')}.` : '';
    run(`gh issue comment ${existing.number} --body ${quote(`Seen again: \`${f.check}\` failed on PR #${f.pr} and passed on a rerun.${tests}`)}`);
    return 'commented';
  }
  run(`gh issue create --title ${quote(title)} --body ${quote(flakyBody(f))} --label ${FLAKY_GATE_LABEL} --label ${quote(intakeLabel)}`);
  return 'filed';
}
