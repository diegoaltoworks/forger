/**
 * `check arch`: the dependency rule as a check. A project names layers as path
 * globs and says which layer may import which; every import that crosses a
 * forbidden edge is a finding. Extraction, resolution and edge checking are
 * pure. Import extractors are keyed by file extension so another language is a
 * new entry, not a change to the check.
 */

import {globToRegExp, type Finding} from './waivers';

export const ARCH_PATH = '.claude/architecture.json';
export const ARCH_OPINION = 'architecture.dependency-rule';

export interface Layer {
  name: string;
  paths: string[];
}

export interface ArchConfig {
  layers: Layer[];
  /** layer -> other layers it may import; a layer may always import itself. */
  allow: Record<string, string[]>;
}

export class ArchConfigError extends Error {
  constructor(problem: string) {
    super(`${ARCH_PATH}: ${problem}`);
  }
}

function strings(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || v.some(s => typeof s !== 'string' || s.trim() === '')) {
    throw new ArchConfigError(`${where} must be a list of non-empty strings`);
  }
  return (v as string[]).map(s => s.trim());
}

/** Parsed once at the boundary: a bad shape or an unknown layer name is an error, never a quiet pass. */
export function parseArchConfig(text: string): ArchConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ArchConfigError('is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ArchConfigError('must be an object');
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.layers)) throw new ArchConfigError('needs a "layers" list');
  const layers = obj.layers.map((l, i): Layer => {
    const where = `layers[${i}]`;
    if (typeof l !== 'object' || l === null || Array.isArray(l)) throw new ArchConfigError(`${where} must be an object`);
    const e = l as Record<string, unknown>;
    if (typeof e.name !== 'string' || e.name.trim() === '') throw new ArchConfigError(`${where} needs a non-empty "name"`);
    return {name: e.name.trim(), paths: strings(e.paths, `${where}.paths`)};
  });
  const names = layers.map(l => l.name);
  if (new Set(names).size !== names.length) throw new ArchConfigError('layer names must be unique');
  const allowRaw = obj.allow ?? {};
  if (typeof allowRaw !== 'object' || allowRaw === null || Array.isArray(allowRaw)) throw new ArchConfigError('"allow" must be an object');
  const allow: Record<string, string[]> = {};
  for (const [from, to] of Object.entries(allowRaw)) {
    if (!names.includes(from)) throw new ArchConfigError(`"allow" names unknown layer ${from}`);
    allow[from] = strings(to, `allow.${from}`);
    for (const t of allow[from]) if (!names.includes(t)) throw new ArchConfigError(`allow.${from} names unknown layer ${t}`);
  }
  return {layers, allow};
}

/** The first layer whose globs match; a file in no layer is not constrained. */
export function layerOf(file: string, config: ArchConfig): string | null {
  for (const layer of config.layers) {
    if (layer.paths.some(p => globToRegExp(p).test(file))) return layer.name;
  }
  return null;
}

export function edgeAllowed(from: string, to: string, config: ArchConfig): boolean {
  return from === to || (config.allow[from] ?? []).includes(to);
}

export type ImportKind = 'static' | 'type' | 'dynamic' | 'reexport' | 'require';

export interface ImportRef {
  specifier: string;
  line: number;
  kind: ImportKind;
}

/** One per language: the extensions it reads, the extensions an extensionless specifier may resolve to, and the extraction. */
export interface ImportExtractor {
  extensions: string[];
  resolveSuffixes: string[];
  extract(text: string): ImportRef[];
}

/** Blank comments out, keeping newlines, so a commented-out import is not an import and line numbers hold. */
function stripComments(text: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
    } else if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
    } else {
      if (c === '"' || c === "'" || c === '`') quote = c;
      out += c;
      i++;
    }
  }
  return out;
}

const STATIC = /(?:^|[;{}\s])import\s+(type\s+)?(?:[^'"`;()]*?\s+from\s+)?(['"])([^'"\n]+)\2/g;
const REEXPORT = /(?:^|[;{}\s])export\s+(type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+(['"])([^'"\n]+)\2/g;
const DYNAMIC = /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;
const REQUIRE = /\brequire\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
}

export const tsExtractor: ImportExtractor = {
  extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
  resolveSuffixes: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js'],
  extract(text) {
    const src = stripComments(text);
    const refs: ImportRef[] = [];
    const scan = (re: RegExp, pick: (m: RegExpExecArray) => {specifier: string; kind: ImportKind; at: number}) => {
      for (const m of src.matchAll(re)) {
        const {specifier, kind, at} = pick(m);
        refs.push({specifier, kind, line: lineAt(src, at)});
      }
    };
    scan(STATIC, m => ({specifier: m[3], kind: m[1] ? 'type' : 'static', at: m.index + m[0].indexOf('import')}));
    scan(REEXPORT, m => ({specifier: m[3], kind: m[1] ? 'type' : 'reexport', at: m.index + m[0].indexOf('export')}));
    scan(DYNAMIC, m => ({specifier: m[2], kind: 'dynamic', at: m.index}));
    scan(REQUIRE, m => ({specifier: m[2], kind: 'require', at: m.index}));
    return refs.sort((a, b) => a.line - b.line);
  },
};

export const EXTRACTORS: ImportExtractor[] = [tsExtractor];

export function extractorFor(file: string, extractors: ImportExtractor[] = EXTRACTORS): ImportExtractor | null {
  return extractors.find(e => e.extensions.some(x => file.endsWith(x))) ?? null;
}

function normalise(path: string): string | null {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.join('/');
}

/** A repo file a relative specifier points at, or null for packages, builtins and paths that leave the repo. */
export function resolveImport(from: string, specifier: string, extractor: ImportExtractor, exists: (path: string) => boolean): string | null {
  if (!specifier.startsWith('.')) return null;
  const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  const base = normalise(`${dir}/${specifier}`);
  if (base === null) return null;
  if (exists(base)) return base;
  for (const s of extractor.resolveSuffixes) if (exists(base + s)) return base + s;
  return null;
}

export interface SourceFile {
  path: string;
  text: string;
}

/** Every import that crosses a forbidden edge, in file then line order. */
export function checkArch(files: SourceFile[], config: ArchConfig, extractors: ImportExtractor[] = EXTRACTORS): Finding[] {
  const known = new Set(files.map(f => f.path));
  const out: Finding[] = [];
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const extractor = extractorFor(file.path, extractors);
    const from = layerOf(file.path, config);
    if (!extractor || from === null) continue;
    for (const ref of extractor.extract(file.text)) {
      const target = resolveImport(file.path, ref.specifier, extractor, p => known.has(p));
      const to = target === null ? null : layerOf(target, config);
      if (target === null || to === null || edgeAllowed(from, to, config)) continue;
      out.push({
        file: file.path,
        line: ref.line,
        rule: 'forbidden-import',
        opinion: ARCH_OPINION,
        detail: `${from} must not import ${to}: ${target} (${ref.kind} import of ${ref.specifier})`,
      });
    }
  }
  return out;
}
