/**
 * `check decisions`: a new dependency or a change to the layer map is an
 * architectural decision, and a decision leaves an ADR behind in the same diff.
 * Classifying a diff is pure; manifest readers are keyed by file name so
 * another ecosystem is a new entry, not a change to the check.
 */

import {toLogical} from '../../config';
import {ARCH_PATH} from '../arch';
import type {Finding} from '../waivers';

export const DECISIONS_OPINION = 'architecture.decisions-recorded';
export const ADR_DIR = 'docs/adr/';

export type ChangeStatus = 'added' | 'modified' | 'deleted';

export interface FileChange {
  path: string;
  status: ChangeStatus;
}

export interface DependencyDiff {
  added: string[];
  removed: string[];
  /** Same name, different version spec: not a new decision. */
  bumped: string[];
}

/** A dependency name -> version spec map for one manifest's text. */
export type ManifestReader = (text: string) => Record<string, string>;

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

export function readPackageJson(text: string): Record<string, string> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('package.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('package.json must be an object');
  const out: Record<string, string> = {};
  for (const field of DEPENDENCY_FIELDS) {
    const deps = (raw as Record<string, unknown>)[field];
    if (typeof deps !== 'object' || deps === null || Array.isArray(deps)) continue;
    for (const [name, spec] of Object.entries(deps)) out[name] = String(spec);
  }
  return out;
}

export const MANIFEST_READERS: Record<string, ManifestReader> = {
  'package.json': readPackageJson,
};

export function manifestReaderFor(path: string, readers: Record<string, ManifestReader> = MANIFEST_READERS): ManifestReader | null {
  return readers[path.split('/').pop() ?? ''] ?? null;
}

/** Old and new text are null when the manifest did not exist on that side. */
export function diffDependencies(before: string | null, after: string | null, read: ManifestReader): DependencyDiff {
  const old = before === null ? {} : read(before);
  const next = after === null ? {} : read(after);
  return {
    added: Object.keys(next).filter(n => !(n in old)),
    removed: Object.keys(old).filter(n => !(n in next)),
    bumped: Object.keys(next).filter(n => n in old && old[n] !== next[n]),
  };
}

export function hasAdr(changes: FileChange[]): boolean {
  return changes.some(c => c.status !== 'deleted' && c.path.startsWith(ADR_DIR) && c.path.endsWith('.md'));
}

export interface ManifestChange {
  path: string;
  diff: DependencyDiff;
  /** 1-based line in the new text of each added dependency, for the finding. */
  lines: Record<string, number>;
}

export function lineOf(text: string, name: string): number {
  const index = text.split('\n').findIndex(l => l.includes(`"${name}"`));
  return index < 0 ? 1 : index + 1;
}

/** Only an added dependency or a touched layer map needs an ADR; removals and bumps are classified and let through. */
export function checkDecisions(changes: FileChange[], manifests: ManifestChange[]): Finding[] {
  if (hasAdr(changes)) return [];
  const findings: Finding[] = [];
  for (const m of manifests) {
    for (const name of m.diff.added) {
      findings.push({
        file: m.path,
        line: m.lines[name] ?? 1,
        rule: 'dependency-without-adr',
        opinion: DECISIONS_OPINION,
        detail: `dependency ${name} was added with no new or changed file under ${ADR_DIR}`,
      });
    }
  }
  if (changes.some(c => toLogical(c.path) === ARCH_PATH)) {
    findings.push({
      file: ARCH_PATH,
      line: 1,
      rule: 'layer-map-without-adr',
      opinion: DECISIONS_OPINION,
      detail: `the layer map changed with no new or changed file under ${ADR_DIR}`,
    });
  }
  return findings;
}

/** `git diff --name-status --no-renames` lines: a rename arrives as a delete plus an add. */
export function parseNameStatus(text: string): FileChange[] {
  const out: FileChange[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const [code, path] = line.split('\t');
    if (!code || !path) throw new Error(`Cannot read git name-status line: ${line}`);
    const status: ChangeStatus = code.startsWith('A') ? 'added' : code.startsWith('D') ? 'deleted' : 'modified';
    out.push({path, status});
  }
  return out;
}
