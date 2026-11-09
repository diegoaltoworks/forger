/**
 * `check structure`: the shape of the tree as a check. Folder size, files that
 * share a first word, names that repeat their folder, frozen folders and files
 * that only re-export. Every rule is pure over a list of paths and a reader for
 * file text; the I/O lives in structure-check.ts and the ratchet in baseline.ts.
 */

import {globToRegExp, type Finding} from '../waivers';
import {observeImports} from './imports';

export const STRUCTURE_PATH = '.forger/structure.json';

export type StructureRule =
  | 'structure.folder-size'
  | 'structure.prefix-cluster'
  | 'structure.name-repeats-folder'
  | 'structure.frozen-folder'
  | 'structure.shim'
  | 'structure.server-guard'
  | 'structure.client-imports-server'
  | 'structure.boundary'
  | 'structure.cycle';

export interface ServerGuard {
  files: string;
  must_import: string;
}

export interface Boundary {
  name: string;
  paths: string[];
  may_import: string[];
  /** Bare package specifiers the group may import; absent means any. */
  external?: string[];
}

export interface StructureConfig {
  source_extensions: string[];
  test_patterns: string[];
  folder_limit: number;
  prefix_cluster: number;
  frozen: string[];
  entry_files: string[];
  ignore: string[];
  server_guards: ServerGuard[];
  client_markers: string[];
  boundaries: Boundary[];
  cycles: boolean;
  review: StructureReviewConfig;
}

/** When the loop files a whole-repo structure review; 0 turns a trigger off. */
export interface StructureReviewConfig {
  every_merged: number;
  warnings_over: number;
}

export class StructureConfigError extends Error {
  constructor(problem: string) {
    super(`${STRUCTURE_PATH}: ${problem}`);
  }
}

const DEFAULTS: StructureConfig = {
  source_extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.rb', '.java', '.kt', '.swift', '.vue', '.svelte'],
  test_patterns: ['**/*.test.*', '**/*.spec.*', '**/test_*.py', '**/*_test.*', '**/__tests__/**'],
  folder_limit: 15,
  prefix_cluster: 4,
  frozen: [],
  entry_files: ['index.*'],
  ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/vendor/**', '**/generated/**', '**/*.d.ts'],
  server_guards: [],
  client_markers: ['"use client"', "'use client'"],
  boundaries: [],
  cycles: false,
  review: {every_merged: 25, warnings_over: 40},
};

const LISTS = ['source_extensions', 'test_patterns', 'frozen', 'entry_files', 'ignore', 'client_markers'] as const;
const NUMBERS = ['folder_limit', 'prefix_cluster'] as const;

/** Parsed once at the boundary: an unknown key or a wrong type is an error naming the key. */
export function parseStructureConfig(text: string): StructureConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new StructureConfigError('is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new StructureConfigError('must be an object');
  const obj = raw as Record<string, unknown>;
  const known: string[] = [...LISTS, ...NUMBERS, 'server_guards', 'boundaries', 'cycles', 'review'];
  for (const key of Object.keys(obj)) if (!known.includes(key)) throw new StructureConfigError(`unknown key "${key}"`);
  const out: StructureConfig = {...DEFAULTS};
  for (const key of LISTS) {
    const v = obj[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.some(s => typeof s !== 'string' || s.trim() === '')) throw new StructureConfigError(`"${key}" must be a list of non-empty strings`);
    out[key] = (v as string[]).map(s => s.trim());
  }
  for (const key of NUMBERS) {
    const v = obj[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new StructureConfigError(`"${key}" must be a whole number of at least 1`);
    out[key] = v;
  }
  out.server_guards = parseServerGuards(obj.server_guards);
  out.boundaries = parseBoundaries(obj.boundaries);
  if (obj.cycles !== undefined) {
    if (typeof obj.cycles !== 'boolean') throw new StructureConfigError('"cycles" must be true or false');
    out.cycles = obj.cycles;
  }
  out.review = parseReview(obj.review);
  return out;
}

function parseReview(v: unknown): StructureReviewConfig {
  if (v === undefined) return {...DEFAULTS.review};
  const o = objectAt(v, '"review"');
  for (const key of Object.keys(o)) if (key !== 'every_merged' && key !== 'warnings_over') throw new StructureConfigError(`unknown key "review.${key}"`);
  const out = {...DEFAULTS.review};
  for (const key of ['every_merged', 'warnings_over'] as const) {
    const n = o[key];
    if (n === undefined) continue;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new StructureConfigError(`"review.${key}" must be a whole number, 0 to turn it off`);
    out[key] = n;
  }
  return out;
}

function objectAt(v: unknown, where: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new StructureConfigError(`${where} must be an object`);
  return v as Record<string, unknown>;
}

function nonEmpty(v: unknown, where: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw new StructureConfigError(`${where} must be a non-empty string`);
  return v.trim();
}

function stringList(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || v.some(s => typeof s !== 'string' || s.trim() === '')) throw new StructureConfigError(`${where} must be a list of non-empty strings`);
  return (v as string[]).map(s => s.trim());
}

function parseServerGuards(v: unknown): ServerGuard[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new StructureConfigError('"server_guards" must be a list');
  return v.map((g, i) => {
    const o = objectAt(g, `server_guards[${i}]`);
    return {files: nonEmpty(o.files, `server_guards[${i}].files`), must_import: nonEmpty(o.must_import, `server_guards[${i}].must_import`)};
  });
}

function parseBoundaries(v: unknown): Boundary[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new StructureConfigError('"boundaries" must be a list');
  const out = v.map((b, i): Boundary => {
    const where = `boundaries[${i}]`;
    const o = objectAt(b, where);
    const boundary: Boundary = {
      name: nonEmpty(o.name, `${where}.name`),
      paths: stringList(o.paths, `${where}.paths`),
      may_import: o.may_import === undefined ? [] : stringList(o.may_import, `${where}.may_import`),
    };
    if (o.external !== undefined) boundary.external = stringList(o.external, `${where}.external`);
    return boundary;
  });
  const names = out.map(b => b.name);
  if (new Set(names).size !== names.length) throw new StructureConfigError('boundary names must be unique');
  for (const b of out) for (const n of b.may_import) if (!names.includes(n)) throw new StructureConfigError(`boundary ${b.name} may_import names unknown boundary ${n}`);
  return out;
}

/** One thing the rules saw. Folder rules carry the folder as `path`; file rules carry the file. */
export interface Observation {
  rule: StructureRule;
  path: string;
  message: string;
  /** structure.folder-size: the source files at the folder's top level. */
  count?: number;
  /** structure.prefix-cluster: the shared first word and the files that share it. */
  prefix?: string;
  files?: string[];
  /** Import rules: the line of the import, 1 for a whole-file finding. Not recorded in the baseline. */
  line?: number;
  /** Import rules: what distinguishes two findings in one file (the specifier, or the cycle). */
  key?: string;
}

export function toFinding(o: Observation): Finding {
  return {file: o.path, line: o.line ?? 1, rule: o.rule, opinion: o.rule, detail: o.message};
}

const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
const stemOf = (name: string): string => (name.includes('.') ? name.slice(0, name.indexOf('.')) : name);
const extOf = (name: string): string => (name.includes('.') ? name.slice(name.lastIndexOf('.')) : '');

/** The first word of a file name, split at `-`, `_`, `.` or a lower-to-upper case change. */
export function firstWord(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .split(/[-_.]/)[0]
    .toLowerCase();
}

export interface SourceSplit {
  sources: string[];
  tests: string[];
}

export function sourceFiles(paths: string[], config: StructureConfig): SourceSplit {
  const ignore = config.ignore.map(globToRegExp);
  const tests = config.test_patterns.map(globToRegExp);
  const out: SourceSplit = {sources: [], tests: []};
  for (const p of paths) {
    if (!config.source_extensions.includes(extOf(baseOf(p))) || ignore.some(re => re.test(p))) continue;
    (tests.some(re => re.test(p)) ? out.tests : out.sources).push(p);
  }
  return out;
}

const SHIM_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const REEXPORT = /export\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s+['"][^'"]+['"]\s*;?/g;

/** True when every statement of the text re-exports from another module; a file with no statements is not a shim. */
export function isShim(text: string): boolean {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (code.trim() === '') return false;
  return code.replace(REEXPORT, '').trim() === '';
}

function groupByFolder(files: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of files) out.set(dirOf(f), [...(out.get(dirOf(f)) ?? []), f]);
  return out;
}

/** The folder name in singular and plural-stripped form, so `stops/stopForm.ts` repeats `stops`. */
function folderStems(folder: string): string[] {
  const name = baseOf(folder).toLowerCase();
  return name.length > 3 && name.endsWith('s') ? [name, name.slice(0, -1)] : [name];
}

function repeatsFolder(file: string): boolean {
  const folder = dirOf(file);
  if (folder === '') return false;
  const stem = stemOf(baseOf(file));
  return folderStems(folder).some(s => {
    if (stem.length <= s.length || !stem.toLowerCase().startsWith(s)) return false;
    return /[-_]|[A-Z]/.test(stem[s.length]);
  });
}

export function observe(paths: string[], config: StructureConfig, read: (path: string) => string): Observation[] {
  const {sources} = sourceFiles(paths, config);
  const entry = config.entry_files.map(globToRegExp);
  const isEntry = (p: string) => entry.some(re => re.test(baseOf(p)));
  const frozen = config.frozen.map(globToRegExp);
  const out: Observation[] = [];

  for (const [folder, files] of groupByFolder(sources)) {
    const where = folder === '' ? '.' : folder;
    if (files.length > config.folder_limit) {
      out.push({
        rule: 'structure.folder-size',
        path: where,
        count: files.length,
        message: `${where} holds ${files.length} source files at its top level (limit ${config.folder_limit}); group them into folders by feature`,
      });
    }
    const byWord = new Map<string, string[]>();
    for (const f of files.filter(f => !isEntry(f))) {
      const w = firstWord(stemOf(baseOf(f)));
      byWord.set(w, [...(byWord.get(w) ?? []), f]);
    }
    for (const [prefix, group] of byWord) {
      if (group.length < config.prefix_cluster) continue;
      out.push({
        rule: 'structure.prefix-cluster',
        path: where,
        prefix,
        files: group.sort(),
        message: `${group.length} files in ${where} start with "${prefix}"; make "${prefix}" a folder and move them into it`,
      });
    }
    if (frozen.some(re => re.test(folder))) {
      for (const f of files) out.push({rule: 'structure.frozen-folder', path: f, message: `${where} is frozen; put ${baseOf(f)} in a folder that is still growing`});
    }
  }
  for (const f of sources) {
    if (repeatsFolder(f)) {
      out.push({rule: 'structure.name-repeats-folder', path: f, message: `${baseOf(f)} repeats its folder's name; drop the "${baseOf(dirOf(f))}" part, the folder already says it`});
    }
    if (!isEntry(f) && SHIM_EXTENSIONS.includes(extOf(baseOf(f))) && isShim(read(f))) {
      out.push({rule: 'structure.shim', path: f, message: `${baseOf(f)} only re-exports from other files; import from the source module and delete it`});
    }
  }
  out.push(...observeImports(sources, config, read));
  return out;
}
