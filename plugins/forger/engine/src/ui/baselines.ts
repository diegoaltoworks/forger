/**
 * Approved screenshot baselines: which captures the owner has approved and
 * where the approved images live. The manifest is data the owner's PR carries;
 * the functions here only read and extend it. Pure.
 */

import {basename} from 'path';

import type {Capture} from './plan';
import {routeSlug} from './plan';

export const BASELINE_DIR = '.forger/ui-baselines/';
export const BASELINE_MANIFEST = `${BASELINE_DIR}approved.json`;

export interface BaselineEntry {
  /** A named state, or a route's slug. */
  name: string;
  approved_by: string;
  /** The repo-relative capture files this approval covers, one per viewport and theme. */
  files: string[];
}

export interface BaselineManifest {
  approved: BaselineEntry[];
}

export class BaselineError extends Error {
  constructor(problem: string) {
    super(`${BASELINE_MANIFEST}: ${problem}`);
  }
}

export function parseBaselines(raw: string): BaselineManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BaselineError('is not valid JSON');
  }
  const list = (parsed as {approved?: unknown} | null)?.approved;
  if (!Array.isArray(list)) throw new BaselineError('must hold an "approved" list');
  const approved = list.map((e: Record<string, unknown>, i) => {
    const files = e?.files;
    if (typeof e?.name !== 'string' || typeof e.approved_by !== 'string' || e.approved_by.trim() === '' || !Array.isArray(files) || files.length === 0 || files.some(f => typeof f !== 'string')) {
      throw new BaselineError(`approved[${i}] needs a name, approved_by and a non-empty list of files`);
    }
    return {name: e.name, approved_by: e.approved_by, files: files as string[]};
  });
  return {approved};
}

/** Where a capture file's approved image is kept. */
export function baselinePath(captureFile: string): string {
  return `${BASELINE_DIR}${basename(captureFile)}`;
}

/** The planned captures a name stands for: the named state, or else the route with that slug. */
export function approvalTargets(plan: Capture[], name: string): Capture[] {
  const states = plan.filter(c => c.state === name);
  return states.length > 0 ? states : plan.filter(c => c.state === undefined && routeSlug(c.route) === name);
}

/** The manifest with `entry` in place of any earlier approval of the same name. */
export function withApproval(manifest: BaselineManifest, entry: BaselineEntry): BaselineManifest {
  return {approved: [...manifest.approved.filter(e => e.name !== entry.name), entry].sort((a, b) => a.name.localeCompare(b.name))};
}

export function baselinedFiles(manifest: BaselineManifest): Set<string> {
  return new Set(manifest.approved.flatMap(e => e.files));
}

/** The images that still need judging: those with no approved baseline. */
export function withoutBaseline(images: string[], manifest: BaselineManifest): string[] {
  const approved = baselinedFiles(manifest);
  return images.filter(i => !approved.has(i));
}
