/**
 * The GitHub labels the loop relies on, declared once. `setup` creates the ones
 * a repository lacks, `decline` checks its relabel against them, and `orient`
 * reports a missing one: a label that does not exist makes `gh` refuse to add
 * it, and the issue silently drops out of the queue.
 */

import type {CommandRunner} from '../ports';

export const NEEDS_INFO_LABEL = 'needs-info';

export interface LabelSpec {
  name: string;
  color: string;
  description: string;
}

/** The labels every loop repository needs; the intake label is configurable, so it is passed in. */
export function loopLabels(intakeLabel: string): LabelSpec[] {
  return [
    {name: intakeLabel, color: '0e8a16', description: 'Ready for the loop to build'},
    {name: NEEDS_INFO_LABEL, color: 'fbca04', description: 'The loop declined this ticket; the owner must answer'},
    {name: 'needs-human', color: 'd93f0b', description: 'Only a human can supply what this needs'},
    {name: 'halted', color: 'b60205', description: 'Stops the loop; set on the pinned loop issue'},
    {name: 'owner-review', color: '5319e7', description: 'Built and verified; the owner merges the PR'},
    {name: 'deferred', color: 'c5def5', description: 'Parked on purpose'},
    {name: 'needs-triage', color: 'ededed', description: 'Not yet looked at'},
    {name: 'flaky-gate', color: 'e99695', description: 'A gate that failed and passed on a rerun; make its test deterministic'},
    {name: 'P0', color: 'b60205', description: 'Priority 0'},
    {name: 'P1', color: 'd93f0b', description: 'Priority 1'},
    {name: 'P2', color: 'fbca04', description: 'Priority 2'},
    {name: 'P3', color: 'c2e0c6', description: 'Priority 3'},
    {name: 'effort:small', color: 'bfdadc', description: 'Small effort'},
    {name: 'effort:medium', color: '9ecbd0', description: 'Medium effort'},
    {name: 'effort:large', color: '5ba3ad', description: 'Large effort'},
  ];
}

/** Declared labels absent from `existing`; GitHub label names compare case-insensitively. */
export function missingLabels(declared: LabelSpec[], existing: string[]): LabelSpec[] {
  const have = new Set(existing.map(l => l.toLowerCase()));
  return declared.filter(l => !have.has(l.name.toLowerCase()));
}

function lines(output: string): string[] {
  return output.split('\n').map(l => l.trim()).filter(l => l !== '');
}

export function listRepoLabels(run: CommandRunner): string[] {
  return lines(run('gh label list --limit 1000 --json name --jq ".[].name"'));
}

export function listIssueLabels(run: CommandRunner, issue: number): string[] {
  return lines(run(`gh issue view ${issue} --json labels --jq ".labels[].name"`));
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Creates each missing loop label; returns the names it created. */
export function ensureLabels(run: CommandRunner, intakeLabel: string): string[] {
  const missing = missingLabels(loopLabels(intakeLabel), listRepoLabels(run));
  for (const l of missing) {
    run(`gh label create ${shellQuote(l.name)} --color ${l.color} --description ${shellQuote(l.description)}`);
  }
  return missing.map(l => l.name);
}

/**
 * What an issue's labels must look like after a decline: the intake label gone,
 * `needs-info` present. Returns the problems, empty when the relabel held.
 */
export function declineRelabelProblems(labels: string[], intakeLabel: string): string[] {
  const have = new Set(labels.map(l => l.toLowerCase()));
  const problems: string[] = [];
  if (!have.has(NEEDS_INFO_LABEL)) problems.push(`label "${NEEDS_INFO_LABEL}" was not added`);
  if (have.has(intakeLabel.toLowerCase())) problems.push(`label "${intakeLabel}" was not removed`);
  return problems;
}
