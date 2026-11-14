/**
 * The guarantees a change must keep (test floors, budgets, baselines,
 * thresholds), as pure decisions: which files hold them by default, which
 * files of a list match the configured globs, which test files name a path,
 * and whether a ticket body states its guards. The reading of files sits in
 * the caller.
 */

import {globToRegExp} from '../checks';
import type {Journey} from '../checks';
import {BASELINE_MANIFEST} from '../ui';
import {STRUCTURE_BASELINE_PATH} from '../checks';

const HEADING = /^#{1,6}\s+(.*?)\s*$/;

export type GuardsSection = {present: false} | {present: true; text: string};

/** The text under a ticket's `Guards` heading, without HTML comments; pure. */
export function guardsSection(body: string): GuardsSection {
  let inSection = false;
  let present = false;
  const lines: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading) {
      inSection = /^guards\b/i.test(heading[1]);
      if (inSection) present = true;
      continue;
    }
    if (inSection) lines.push(line);
  }
  if (!present) return {present: false};
  return {present: true, text: lines.join('\n').replace(/<!--[\s\S]*?-->/g, '').trim()};
}

export interface GuardsCheck {
  warnings: string[];
  problems: string[];
}

/** A missing section warns, so tickets filed before the section existed still run; an empty one is refused. */
export function checkGuards(body: string): GuardsCheck {
  const section = guardsSection(body);
  if (!section.present) {
    return {warnings: ['has no Guards section; list each guarantee the change must keep with its file and value, or "none"'], problems: []};
  }
  if (section.text === '') {
    return {warnings: [], problems: ['the Guards section is empty; list each guarantee the change must keep with its file and value, or "none"']};
  }
  return {warnings: [], problems: []};
}

export interface GuardSources {
  /** `coverage_baseline` of `testing.json`; null when the testing pack is not installed. */
  coverageBaseline: string | null;
  /** True when `ui.json` exists, so the approved-baselines manifest is a guard. */
  uiInstalled: boolean;
  /** True when `structure.json` exists, so the structure baseline is a guard. */
  structureInstalled: boolean;
}

/** The guard globs a project has when it configures none; pure. */
export function defaultGuards(sources: GuardSources): string[] {
  const out: string[] = [];
  if (sources.coverageBaseline) out.push(sources.coverageBaseline);
  if (sources.uiInstalled) out.push(BASELINE_MANIFEST);
  if (sources.structureInstalled) out.push(STRUCTURE_BASELINE_PATH);
  return out;
}

/** The files, of those listed, that match any glob; pure. */
export function matchGlobs(files: string[], globs: string[]): string[] {
  const res = globs.map(globToRegExp);
  return files.filter(f => res.some(re => re.test(f)));
}

export interface GuardsReport {
  paths: string[];
  guards: string[];
  tests: string[];
  /** Names of the journeys whose paths match a touched path. */
  journeys: string[];
}

/** The guard files among `files`, and the test files whose text names any of `paths`; pure over the reader. */
export function guardsReport(
  paths: string[],
  files: string[],
  guardGlobs: string[],
  testGlobs: string[],
  read: (file: string) => string,
  journeys: Journey[] = []
): GuardsReport {
  const guards = matchGlobs(files, guardGlobs);
  const tests = matchGlobs(files, testGlobs).filter(f => {
    let text: string;
    try {
      text = read(f);
    } catch {
      return false;
    }
    return paths.some(p => p !== '' && text.includes(p));
  });
  const named = journeys.filter(j => paths.some(p => matchGlobs([p], j.paths).length > 0)).map(j => j.name);
  return {paths, guards, tests, journeys: named};
}

export function formatGuardsReport(r: GuardsReport): string {
  const list = (title: string, items: string[]) => `${title}:\n${items.length === 0 ? '  none' : items.map(i => `  ${i}`).join('\n')}`;
  return [list('guard files', r.guards), list(`test files naming ${r.paths.join(', ')}`, r.tests), list('journeys through them', r.journeys)].join('\n');
}
