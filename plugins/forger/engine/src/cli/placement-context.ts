/**
 * Reads what `check ticket` needs to judge a Placement section: the structure
 * pack's frozen folders and baseline, and the open tickets labelled
 * `structure`. A project without the pack has nothing flagged.
 */

import {existsSync, readFileSync} from 'fs';

import {parseStructureBaseline, parseStructureConfig, STRUCTURE_BASELINE_PATH, STRUCTURE_PATH} from '../checks';
import {forgerPath} from '../config';
import type {PlacementContext} from '../loop';
import type {CommandRunner} from '../ports';

function read(projectRoot: string, rel: string): string | null {
  const file = forgerPath(projectRoot, rel);
  return existsSync(file) ? readFileSync(file, 'utf-8') : null;
}

export function placementContext(projectRoot: string, run: CommandRunner, blockedBy: number[]): PlacementContext {
  const config = read(projectRoot, STRUCTURE_PATH);
  if (config === null) return {frozen: [], overLimit: [], structureTickets: [], blockedBy};
  const baseline = read(projectRoot, STRUCTURE_BASELINE_PATH);
  const overLimit = baseline === null ? [] : parseStructureBaseline(baseline).entries.filter(e => e.rule === 'structure.folder-size').map(e => e.path);
  const listed = run('gh issue list --label structure --state open --json number --jq ".[].number"');
  const structureTickets = listed.split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger);
  return {frozen: parseStructureConfig(config).frozen, overLimit, structureTickets, blockedBy};
}
