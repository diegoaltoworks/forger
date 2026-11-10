/**
 * Which tickets may run together (ADR 0011). Pure: the footprint comes from a
 * ticket's Knock-on text, the folder map from the architecture map's module
 * roots and the directories the caller lists, and nothing here reads either.
 */

/** What a ticket is expected to touch; `null` is an undeclared footprint. */
export interface Footprint {
  /** Paths as written in the ticket, without trailing slashes. */
  paths: string[];
  /** Names written as "<name> module". */
  modules: string[];
}

/**
 * The folder map. `roots` are the module roots (`modules.paths` of the
 * architecture map with the trailing `/*` removed); `folders` are the module
 * folders under them, as full paths.
 */
export interface FolderMap {
  roots: string[];
  folders: string[];
}

export interface Schedulable {
  id: string;
  footprint: Footprint | null;
  /** Carries the `serial` label. */
  serial?: boolean;
}

export interface ScheduleOptions {
  /** Direct dependencies of every known ticket, for following them transitively. */
  graph?: Record<string, string[]>;
  /** Footprint patterns (`*` any run of characters) that make a ticket serial-class. */
  serialPatterns?: string[];
}

export type ScheduleReason =
  | 'serial-class'
  | 'dependent'
  | 'unknown-footprint'
  | 'same-path'
  | 'same-folder'
  | 'disjoint';

export interface ScheduleVerdict {
  verdict: 'parallel' | 'serial';
  reason: ScheduleReason;
}

const PATH_TOKEN = /`([^`\s]+)`/g;
const MODULE_NAME = /\b([A-Za-z][\w-]*) module\b/g;

function trimPath(p: string): string {
  return p.replace(/^\.\//, '').replace(/\/+$/, '');
}

function looksLikePath(token: string): boolean {
  return token.includes('/') || /\.[A-Za-z0-9]+$/.test(token);
}

/** The text under the ticket's `## Knock-on` heading, or null when there is none. */
export function knockOnSection(body: string): string | null {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex(l => /^#{1,6}\s+knock-on\s*$/i.test(l.trim()));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(l => /^#{1,6}\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

/**
 * A ticket body to its footprint: backticked paths and "<name> module"
 * phrases in the Knock-on section. No section, an empty one, or one naming
 * nothing (`none`) is an unknown footprint, which schedules as serial.
 */
export function parseFootprint(body: string): Footprint | null {
  const section = knockOnSection(body);
  if (section === null) return null;
  const paths = new Set<string>();
  for (const m of section.matchAll(PATH_TOKEN)) {
    const token = m[1] ?? '';
    if (looksLikePath(token)) paths.add(trimPath(token));
  }
  const modules = new Set<string>();
  for (const m of section.matchAll(MODULE_NAME)) {
    const name = m[1] ?? '';
    if (name) modules.add(name);
  }
  if (paths.size === 0 && modules.size === 0) return null;
  return {paths: [...paths], modules: [...modules]};
}

/** Module roots from the architecture map's `modules.paths` globs. */
export function rootsFromModulePaths(paths: string[]): string[] {
  return paths.map(p => trimPath(p.replace(/\/\*+$/, '')));
}

function within(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

/** The module folders a footprint touches. A path outside every folder (a doc) touches none. */
export function resolveFolders(footprint: Footprint, map: FolderMap): string[] {
  const found = new Set<string>();
  for (const raw of footprint.paths) {
    const path = trimPath(raw);
    for (const folder of map.folders) {
      if (within(path, folder)) found.add(folder);
    }
    for (const root of map.roots) {
      for (const folder of map.folders) {
        if (within(`${root}/${path}`, folder) && folder.startsWith(`${root}/`)) found.add(folder);
      }
    }
  }
  for (const name of footprint.modules) {
    for (const folder of map.folders) {
      if (folder.split('/').pop() === name) found.add(folder);
    }
  }
  return [...found];
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}`);
}

/** Serial-class: the `serial` label, or a footprint path or module matching a configured pattern. */
export function isSerialClass(ticket: Schedulable, patterns: string[] = []): boolean {
  if (ticket.serial) return true;
  const fp = ticket.footprint;
  if (!fp || patterns.length === 0) return false;
  const regexes = patterns.map(globToRegExp);
  const subjects = [...fp.paths, ...fp.modules];
  return subjects.some(s => regexes.some(r => r.test(s) || r.test(`${s}/`)));
}

/** True when `from` depends on `target`, directly or through other tickets. */
export function dependsOn(
  from: string,
  target: string,
  graph: Record<string, string[]> = {}
): boolean {
  const seen = new Set<string>();
  const stack = [...(graph[from] ?? [])];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(graph[id] ?? []));
  }
  return false;
}

export function pathsOverlap(a: string[], b: string[]): boolean {
  return a.some(x => b.some(y => within(trimPath(x), trimPath(y)) || within(trimPath(y), trimPath(x))));
}

/** Whether two tickets may run together; first matching rule wins. */
export function schedule(
  a: Schedulable,
  b: Schedulable,
  map: FolderMap,
  options: ScheduleOptions = {}
): ScheduleVerdict {
  const serial = (reason: ScheduleReason): ScheduleVerdict => ({verdict: 'serial', reason});
  if (isSerialClass(a, options.serialPatterns) || isSerialClass(b, options.serialPatterns)) {
    return serial('serial-class');
  }
  if (dependsOn(a.id, b.id, options.graph) || dependsOn(b.id, a.id, options.graph)) {
    return serial('dependent');
  }
  if (!a.footprint || !b.footprint) return serial('unknown-footprint');
  if (pathsOverlap(a.footprint.paths, b.footprint.paths)) return serial('same-path');
  const foldersA = resolveFolders(a.footprint, map);
  const foldersB = resolveFolders(b.footprint, map);
  if (foldersA.some(f => foldersB.includes(f))) return serial('same-folder');
  return {verdict: 'parallel', reason: 'disjoint'};
}

/**
 * The candidates to start now, in the engine's order: each must be parallel
 * with every running ticket and every ticket already chosen, up to the
 * parallelism limit. With nothing running the first candidate is always taken
 * (a lone ticket needs no partner), so a limit of 1 returns what `next` does.
 */
export function pick<T extends Schedulable>(
  candidates: T[],
  running: Schedulable[],
  parallelism: number,
  map: FolderMap,
  options: ScheduleOptions = {}
): T[] {
  const chosen: T[] = [];
  const slots = Math.max(0, Math.floor(parallelism)) - running.length;
  if (slots <= 0) return chosen;
  const active: Schedulable[] = [...running];
  for (const candidate of candidates) {
    if (chosen.length >= slots) break;
    const lone = active.length === 0;
    if (lone || active.every(r => schedule(candidate, r, map, options).verdict === 'parallel')) {
      chosen.push(candidate);
      active.push(candidate);
    }
  }
  return chosen;
}

/** Whether two declared footprints share a path or a module name; an undeclared footprint shares nothing. */
export function footprintsShare(a: Footprint | null, b: Footprint | null): boolean {
  if (!a || !b) return false;
  return pathsOverlap(a.paths, b.paths) || a.modules.some(m => b.modules.includes(m));
}
