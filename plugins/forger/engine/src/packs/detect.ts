/**
 * Suggesting packs from facts about a repository. A pack's `detect` rules are
 * evaluated against facts gathered once by a thin reader, so the evaluation is a
 * pure function over plain data. A pack with no rules is never suggested.
 *
 * A rule is `kind:value`:
 * - `file:<path>` a file whose path is `<path>` or ends with `/<path>`
 * - `dir:<path>` a directory matched the same way
 * - `dep:<name>` a dependency (or dev dependency) in the root `package.json`
 * - `glob:<pattern>` a file whose name matches the pattern, where `*` stands for any run of characters
 * - `table:<name>` a table header such as `tool.pytest.ini_options` in the root `pyproject.toml`
 */

import {existsSync, readdirSync, readFileSync} from 'fs';
import {join} from 'path';

import type {LoadedPack, Lock} from './packs';

export const RULE_KINDS = ['file', 'dir', 'dep', 'glob', 'table'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export interface Rule {
  kind: RuleKind;
  value: string;
}

export interface RepoFacts {
  /** Files, relative to the root, `/`-separated. */
  files: string[];
  /** Directories, relative to the root, `/`-separated. */
  dirs: string[];
  /** Names in the root package.json `dependencies` and `devDependencies`. */
  deps: string[];
  /** Table names in the root pyproject.toml, such as `tool.pytest.ini_options`. */
  tables: string[];
}

export interface Suggestion {
  id: string;
  version: string;
  description: string;
  /** The rules that matched: the facts that triggered the suggestion. */
  reasons: string[];
}

/** The rule a string spells, or null when it is not one. */
export function parseRule(text: string): Rule | null {
  const at = text.indexOf(':');
  if (at < 0) return null;
  const kind = text.slice(0, at);
  const value = text.slice(at + 1);
  if (!(RULE_KINDS as readonly string[]).includes(kind) || value === '' || /\s/.test(value)) return null;
  if (kind === 'glob' && value.includes('/')) return null;
  if (kind !== 'dep' && kind !== 'table' && (value.startsWith('/') || value.split('/').includes('..'))) return null;
  return {kind: kind as RuleKind, value};
}

function pathMatches(paths: string[], wanted: string): boolean {
  return paths.some(p => p === wanted || p.endsWith(`/${wanted}`));
}

function globMatches(paths: string[], pattern: string): boolean {
  const re = new RegExp(`^${pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return paths.some(p => re.test(p.slice(p.lastIndexOf('/') + 1)));
}

export function matchRule(rule: Rule, facts: RepoFacts): boolean {
  if (rule.kind === 'glob') return globMatches(facts.files, rule.value);
  if (rule.kind === 'table') return facts.tables.includes(rule.value);
  if (rule.kind === 'file') return pathMatches(facts.files, rule.value);
  if (rule.kind === 'dir') return pathMatches(facts.dirs, rule.value);
  return facts.deps.includes(rule.value);
}

/** The packs whose rules match, with the rules that matched; installed packs are left out. */
export function detectPacks(available: LoadedPack[], lock: Lock, facts: RepoFacts): Suggestion[] {
  const out: Suggestion[] = [];
  for (const {manifest: m} of available) {
    if (lock.packs.some(p => p.id === m.id)) continue;
    const reasons = m.detect.filter(text => {
      const rule = parseRule(text);
      return rule !== null && matchRule(rule, facts);
    });
    if (reasons.length > 0) out.push({id: m.id, version: m.version, description: m.description, reasons});
  }
  return out;
}

export function formatSuggestions(list: Suggestion[]): string {
  if (list.length === 0) return 'no packs suggested';
  return list.map(s => `${s.id.padEnd(12)} ${s.reasons.join(', ')}`).join('\n');
}

const SKIPPED_DIRS = new Set(['.git', 'node_modules', '.forger', '.claude', 'dist', 'build', 'target', 'vendor', '.venv']);
const MAX_DEPTH = 4;

/** Walks the repository to a bounded depth and reads the root package.json. An unreadable package.json throws. */
export function readRepoFacts(root: string): RepoFacts {
  const files: string[] = [];
  const dirs: string[] = [];
  const walk = (rel: string, depth: number): void => {
    for (const e of readdirSync(join(root, rel), {withFileTypes: true})) {
      const path = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (SKIPPED_DIRS.has(e.name)) continue;
        dirs.push(path);
        if (depth < MAX_DEPTH) walk(path, depth + 1);
      } else if (e.isFile()) {
        files.push(path);
      }
    }
  };
  walk('', 1);

  const pkgPath = join(root, 'package.json');
  let deps: string[] = [];
  if (existsSync(pkgPath)) {
    let pkg: unknown;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch {
      throw new Error('package.json is not valid JSON');
    }
    const field = (name: string): string[] => {
      const v = typeof pkg === 'object' && pkg !== null ? (pkg as Record<string, unknown>)[name] : undefined;
      return typeof v === 'object' && v !== null && !Array.isArray(v) ? Object.keys(v) : [];
    };
    deps = [...new Set([...field('dependencies'), ...field('devDependencies')])];
  }
  const tomlPath = join(root, 'pyproject.toml');
  const tables = existsSync(tomlPath)
    ? [...readFileSync(tomlPath, 'utf-8').matchAll(/^\s*\[\[?\s*([^\][]+?)\s*\]\]?\s*(?:#.*)?$/gm)].map(m => m[1])
    : [];
  return {files: files.sort(), dirs: dirs.sort(), deps: deps.sort(), tables: [...new Set(tables)].sort()};
}
