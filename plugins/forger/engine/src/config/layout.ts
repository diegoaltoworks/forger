/**
 * Where forger keeps its own files. This is the only module that names the
 * folder: everything else speaks in logical paths under `.forger/` and asks
 * here for the physical one. A repo set up before `.forger/` existed keeps its
 * files in `.claude/` (the legacy layout) until `migrate` moves them, so the
 * same logical path resolves to either.
 */

import {existsSync} from 'fs';
import {dirname, join} from 'path';

export const FORGER_DIR = '.forger';
export const LEGACY_DIR = '.claude';
export const CONFIG_FILE = 'workloop.config.json';

export interface Layout {
  /** The folder holding forger's files, relative to the project root. */
  dir: string;
  legacy: boolean;
}

/** Files and folders forger owns in the legacy folder; anything else there belongs to the harness. */
export const OWNED = [
  CONFIG_FILE,
  'backlog.json',
  'backlog.md',
  'state.json',
  'work.log',
  'output',
  'HALT',
  'runner.lock',
  'events.jsonl',
  'declined.json',
  'forger.lock.json',
  'process.md',
  'human.md',
  'inbox',
  'opinions',
  'templates',
  'rules',
  'waivers.json',
  'architecture.json',
  'testing.json',
  'safety.json',
  'ui.json',
  'coverage-baseline.json',
];

/** Pure: `.forger/` wins; the legacy folder counts only when it holds a forger config. */
export function chooseLayout(has: {forger: boolean; legacyConfig: boolean}): Layout {
  if (!has.forger && has.legacyConfig) return {dir: LEGACY_DIR, legacy: true};
  return {dir: FORGER_DIR, legacy: false};
}

/** The marker facts of a directory: whether it holds `.forger/`, or a legacy `.claude/` with a forger config. */
export function readMarkers(dir: string): {forger: boolean; legacyConfig: boolean} {
  return {
    forger: existsSync(join(dir, FORGER_DIR)),
    legacyConfig: existsSync(join(dir, LEGACY_DIR, CONFIG_FILE)),
  };
}

export function detectLayout(projectRoot: string): Layout {
  return chooseLayout(readMarkers(projectRoot));
}

/** Whether a directory is a project root for forger: it holds `.forger/`, or a legacy `.claude/` with a forger config. */
export function isProjectRoot(dir: string): boolean {
  const {forger, legacyConfig} = readMarkers(dir);
  return forger || legacyConfig;
}

/**
 * Pure: the root forger acts on, from the facts of the directories between the
 * working directory and the git top-level. The nearest one holding `.forger/`
 * or a legacy `.claude/` with a forger config wins; the git top-level answers
 * when none does, so setup and the packs commands run there before any
 * `.forger/` exists. Outside a repository the climb runs on, and the working
 * directory answers when no directory holds a marker. The home directory is
 * never a root: every user's home holds a harness folder, and acting there
 * would read files far from the project.
 */
export function chooseProjectRoot(
  cwd: string,
  gitTop: string | null,
  markersOf: (dir: string) => {forger: boolean; legacyConfig: boolean},
  home: string
): string {
  let dir = cwd;
  for (;;) {
    if (dir !== home) {
      const {forger, legacyConfig} = markersOf(dir);
      if (forger || legacyConfig) return dir;
    }
    if (dir === (gitTop ?? dirname(dir))) break;
    dir = dirname(dir);
  }
  return gitTop ?? cwd;
}

/** Pure: a logical `.forger/x` path as the layout stores it. Other paths are returned as they are. */
export function toPhysical(layout: Layout, path: string): string {
  return path.startsWith(`${FORGER_DIR}/`) ? `${layout.dir}/${path.slice(FORGER_DIR.length + 1)}` : path;
}

/** Pure: a forger-owned `.claude/x` path as its logical `.forger/x`. Harness files are returned as they are. */
export function toLogical(path: string): string {
  if (!path.startsWith(`${LEGACY_DIR}/`)) return path;
  const rest = path.slice(LEGACY_DIR.length + 1);
  const top = rest.split('/')[0];
  return OWNED.includes(top) || top.endsWith('.upstream') ? `${FORGER_DIR}/${rest}` : path;
}

/** The absolute path of a logical `.forger/x` path in this project. */
export function forgerPath(projectRoot: string, logical: string): string {
  return join(projectRoot, toPhysical(detectLayout(projectRoot), logical));
}

export function legacyWarning(layout: Layout): string | null {
  return layout.legacy
    ? `forger: this repo keeps its files in ${LEGACY_DIR}/ (the legacy layout). Run "work.ts migrate" to move them to ${FORGER_DIR}/.`
    : null;
}

/** Pure: rewrites the references to forger-owned legacy paths inside a config file's text. */
export function rewriteReferences(text: string): string {
  return text.replace(/\.claude\/([A-Za-z0-9_.-]+)/g, (whole, top: string) => (OWNED.includes(top) ? `${FORGER_DIR}/${top}` : whole));
}
