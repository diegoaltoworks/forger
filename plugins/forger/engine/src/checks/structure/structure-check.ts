/**
 * The I/O half of `check structure`: lists the project's files, reads the
 * config and baseline, and on a branch compares the baseline with the
 * merge-base's. A missing config or an unresolvable base is an error, never a
 * pass.
 */

import {existsSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';

import {forgerPath, loadConfig} from '../../config';
import type {CommandRunner} from '../../ports';
import {mergeBase} from '../decisions';
import {projectFiles} from '../files';
import {decisionsOfBranch, withoutDecided} from '../guards';
import type {Finding} from '../waivers';
import {STRUCTURE_BASELINE_PATH, baselineGrew, classify, parseStructureBaseline, renderStructureBaseline, shrink, type StructureBaseline} from './baseline';
import {observe, parseStructureConfig, STRUCTURE_PATH, toFinding, type Observation, type StructureConfig} from './structure';

export interface StructureOutput {
  findings: Finding[];
  warnings: Finding[];
}

function readConfig(projectRoot: string): StructureConfig {
  const path = forgerPath(projectRoot, STRUCTURE_PATH);
  if (!existsSync(path)) throw new Error(`${STRUCTURE_PATH} not found; the structure pack's config is required`);
  return parseStructureConfig(readFileSync(path, 'utf-8'));
}

function readBaseline(projectRoot: string): StructureBaseline | null {
  const path = forgerPath(projectRoot, STRUCTURE_BASELINE_PATH);
  return existsSync(path) ? parseStructureBaseline(readFileSync(path, 'utf-8')) : null;
}

function observations(projectRoot: string, run: CommandRunner): Observation[] {
  const config = readConfig(projectRoot);
  const paths = projectFiles(run).filter(p => existsSync(join(projectRoot, p)));
  return observe(paths, config, p => readFileSync(join(projectRoot, p), 'utf-8'));
}

/** The baseline at the merge-base, or null when the branch is what first adds it. */
function baselineAtBase(projectRoot: string, run: CommandRunner): StructureBaseline | null {
  const mb = mergeBase(run, loadConfig(projectRoot).base_branch);
  let text = '';
  try {
    text = run(`git show ${mb}:${STRUCTURE_BASELINE_PATH}`);
  } catch {
    return null;
  }
  return text.trim() === '' ? null : parseStructureBaseline(text);
}

export function runStructureCheck(projectRoot: string, run: CommandRunner): StructureOutput {
  const baseline = readBaseline(projectRoot);
  const {fresh, recorded} = classify(observations(projectRoot, run), baseline);
  const findings = fresh.map(toFinding);
  if (baseline) {
    const before = baselineAtBase(projectRoot, run);
    if (before) findings.push(...withoutDecided(baselineGrew(before, baseline), decisionsOfBranch(run)));
  }
  return {findings, warnings: recorded.map(toFinding)};
}

/** Writes the baseline from the current findings; refuses when one exists. */
export function writeStructureBaseline(projectRoot: string, run: CommandRunner): number {
  const path = forgerPath(projectRoot, STRUCTURE_BASELINE_PATH);
  if (existsSync(path)) throw new Error(`${STRUCTURE_BASELINE_PATH} already exists; use "check structure --update" to drop entries that no longer hold`);
  const current = observations(projectRoot, run);
  writeFileSync(path, renderStructureBaseline(current));
  return current.length;
}

/** Drops baseline entries that no longer hold; returns how many were removed. */
export function updateStructureBaseline(projectRoot: string, run: CommandRunner): number {
  const baseline = readBaseline(projectRoot);
  if (!baseline) throw new Error(`${STRUCTURE_BASELINE_PATH} not found; write it first with "check structure --baseline"`);
  const next = shrink(observations(projectRoot, run), baseline);
  const removed = baseline.entries.length - next.entries.length;
  writeFileSync(forgerPath(projectRoot, STRUCTURE_BASELINE_PATH), `${JSON.stringify(next, null, 2)}\n`);
  return removed;
}
