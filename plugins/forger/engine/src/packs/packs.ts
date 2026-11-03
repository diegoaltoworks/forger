/**
 * Opinion packs: a pack is a directory with a `pack.json` manifest and the files
 * it installs. Parsing is pure and validates once at the boundary, so a bad
 * manifest is an error that names the field and never a silently skipped pack.
 * Only loading touches the disk.
 */

import {createHash} from 'crypto';
import {existsSync, readdirSync, readFileSync} from 'fs';
import {join} from 'path';

import {toLogical} from '../config';

/** Where an opinion sits on the refinement ladder, weakest to strongest. */
export const RUNGS = ['note', 'rule', 'template', 'check', 'tool'] as const;
export type Rung = (typeof RUNGS)[number];

export interface PackFile {
  /** Path inside the pack directory. */
  source: string;
  /** Path in the project. */
  target: string;
}

export interface Opinion {
  id: string;
  rung: Rung;
  summary: string;
  /** The id of one of the pack's checks that enforces it, or null. */
  check: string | null;
}

export interface Manifest {
  id: string;
  version: string;
  description: string;
  detect: string[];
  files: PackFile[];
  opinions: Opinion[];
  checks: string[];
  slots: string[];
}

export class ManifestError extends Error {
  constructor(
    readonly field: string,
    problem: string,
    readonly pack?: string
  ) {
    super(`${pack ? `pack ${pack}: ` : ''}manifest field "${field}" ${problem}`);
  }
}

const ID = /^[a-z][a-z0-9-]*$/;
const OPINION_ID = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw new ManifestError(field, 'must be a non-empty string');
  return v;
}

function strList(v: unknown, field: string): string[] {
  if (!Array.isArray(v)) throw new ManifestError(field, 'must be a list');
  return v.map((x, i) => str(x, `${field}[${i}]`));
}

/** A relative path that stays inside its directory. */
function safePath(v: unknown, field: string): string {
  const p = str(v, field);
  if (p.startsWith('/') || p.split('/').includes('..')) throw new ManifestError(field, 'must be a relative path inside its directory');
  return p;
}

export function parseManifest(raw: unknown): Manifest {
  if (!isRecord(raw)) throw new ManifestError('(root)', 'must be an object');
  const id = str(raw.id, 'id');
  if (!ID.test(id)) throw new ManifestError('id', 'must be lowercase letters, digits and hyphens');
  const version = str(raw.version, 'version');
  if (!SEMVER.test(version)) throw new ManifestError('version', 'must look like 1.2.3', id);
  const description = str(raw.description, 'description');
  const detect = strList(raw.detect, 'detect');
  const slots = strList(raw.slots, 'slots');
  const checks = strList(raw.checks, 'checks');

  if (!Array.isArray(raw.files)) throw new ManifestError('files', 'must be a list', id);
  const files = raw.files.map((f, i): PackFile => {
    if (!isRecord(f)) throw new ManifestError(`files[${i}]`, 'must be an object', id);
    return {source: safePath(f.source, `files[${i}].source`), target: safePath(f.target, `files[${i}].target`)};
  });
  const targets = files.map(f => f.target);
  const dup = targets.find((t, i) => targets.indexOf(t) !== i);
  if (dup) throw new ManifestError('files', `lists target ${dup} twice`, id);

  if (!Array.isArray(raw.opinions)) throw new ManifestError('opinions', 'must be a list', id);
  const opinions = raw.opinions.map((o, i): Opinion => {
    const at = `opinions[${i}]`;
    if (!isRecord(o)) throw new ManifestError(at, 'must be an object', id);
    const oid = str(o.id, `${at}.id`);
    if (!OPINION_ID.test(oid) || !oid.startsWith(`${id}.`)) throw new ManifestError(`${at}.id`, `must look like ${id}.some-name`, id);
    const rung = str(o.rung, `${at}.rung`);
    if (!(RUNGS as readonly string[]).includes(rung)) throw new ManifestError(`${at}.rung`, `must be one of ${RUNGS.join(', ')}`, id);
    const summary = str(o.summary, `${at}.summary`);
    if (o.check !== null && typeof o.check !== 'string') throw new ManifestError(`${at}.check`, 'must be a check id or null', id);
    if (typeof o.check === 'string' && !checks.includes(o.check)) throw new ManifestError(`${at}.check`, `names ${o.check}, which is not in checks`, id);
    if ((rung === 'check') !== (o.check !== null)) throw new ManifestError(`${at}.check`, 'must be set exactly when the rung is check', id);
    return {id: oid, rung: rung as Rung, summary, check: o.check as string | null};
  });
  const ids = opinions.map(o => o.id);
  const dupOpinion = ids.find((x, i) => ids.indexOf(x) !== i);
  if (dupOpinion) throw new ManifestError('opinions', `lists ${dupOpinion} twice`, id);

  return {id, version, description, detect, files, opinions, checks, slots};
}

export interface LoadedPack {
  manifest: Manifest;
  dir: string;
}

/** Every pack under `<pluginRoot>/packs`, sorted by id. A bad manifest throws. */
export function loadPacks(pluginRoot: string): LoadedPack[] {
  const root = join(pluginRoot, 'packs');
  if (!existsSync(root)) return [];
  const packs = readdirSync(root, {withFileTypes: true})
    .filter(d => d.isDirectory())
    .map(d => {
      const dir = join(root, d.name);
      const path = join(dir, 'pack.json');
      if (!existsSync(path)) throw new ManifestError('(file)', 'is missing: pack.json not found', d.name);
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(path, 'utf-8'));
      } catch {
        throw new ManifestError('(file)', 'is not valid JSON', d.name);
      }
      const manifest = parseManifest(raw);
      if (manifest.id !== d.name) throw new ManifestError('id', `must equal the directory name ${d.name}`, manifest.id);
      for (const f of manifest.files) {
        if (!existsSync(join(dir, f.source))) throw new ManifestError('files', `names ${f.source}, which does not exist`, manifest.id);
      }
      return {manifest, dir};
    });
  return packs.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

/** Turns `--packs a,b` into ids; empty means the default. */
export function parsePackList(arg: string | undefined): string[] {
  const ids = (arg ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return ids.length === 0 ? ['base'] : [...new Set(ids)];
}

/** The packs to install, in order, or the unknown ids. */
export function selectPacks(available: LoadedPack[], ids: string[]): {packs: LoadedPack[]; unknown: string[]} {
  const byId = new Map(available.map(p => [p.manifest.id, p]));
  const unknown = ids.filter(i => !byId.has(i));
  return {packs: ids.flatMap(i => byId.get(i) ?? []), unknown};
}

export const LOCK_PATH = '.forger/forger.lock.json';

export interface LockedFile {
  path: string;
  sha256: string;
}

export interface LockedPack {
  id: string;
  version: string;
  files: LockedFile[];
}

export interface Lock {
  packs: LockedPack[];
}

export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Folds one install into the lock. Files already recorded keep their recorded
 * hash, so a project edit never rewrites it; files written now are added; files
 * the project already had are not recorded because forger did not install them.
 */
export function mergeLock(existing: Lock, installs: Array<{manifest: Manifest; written: LockedFile[]}>): Lock {
  const packs = existing.packs.map(p => ({...p, files: [...p.files]}));
  for (const {manifest, written} of installs) {
    let entry = packs.find(p => p.id === manifest.id);
    if (!entry) {
      entry = {id: manifest.id, version: manifest.version, files: []};
      packs.push(entry);
    }
    for (const f of written) if (!entry.files.some(x => x.path === f.path)) entry.files.push(f);
    entry.files.sort((a, b) => a.path.localeCompare(b.path));
  }
  return {packs};
}

export function renderLock(lock: Lock): string {
  return JSON.stringify(lock, null, 2) + '\n';
}

export function parseLock(text: string): Lock {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ManifestError('lock', `${LOCK_PATH} is not valid JSON`);
  }
  if (!isRecord(raw) || !Array.isArray(raw.packs)) throw new ManifestError('lock.packs', 'must be a list');
  const packs = raw.packs.map((p, i): LockedPack => {
    if (!isRecord(p) || !Array.isArray(p.files)) throw new ManifestError(`lock.packs[${i}]`, 'must have id, version and files');
    return {
      id: str(p.id, `lock.packs[${i}].id`),
      version: str(p.version, `lock.packs[${i}].version`),
      files: p.files.map((f, j) => {
        if (!isRecord(f)) throw new ManifestError(`lock.packs[${i}].files[${j}]`, 'must be an object');
        return {path: toLogical(str(f.path, `lock.packs[${i}].files[${j}].path`)), sha256: str(f.sha256, `lock.packs[${i}].files[${j}].sha256`)};
      }),
    };
  });
  return {packs};
}

export interface PackListing {
  id: string;
  version: string;
  description: string;
  installed: boolean;
  installedVersion: string | null;
}

export function listPacks(available: LoadedPack[], lock: Lock): PackListing[] {
  return available.map(({manifest: m}) => {
    const locked = lock.packs.find(p => p.id === m.id);
    return {id: m.id, version: m.version, description: m.description, installed: !!locked, installedVersion: locked?.version ?? null};
  });
}

export interface OpinionListing extends Opinion {
  pack: string;
}

/** Every opinion of the installed packs, in lock order. */
export function listOpinions(available: LoadedPack[], lock: Lock): OpinionListing[] {
  return lock.packs.flatMap(lp => {
    const pack = available.find(a => a.manifest.id === lp.id);
    return (pack?.manifest.opinions ?? []).map(o => ({...o, pack: lp.id}));
  });
}

export function formatPacks(list: PackListing[]): string {
  return list.map(p => `${p.installed ? '*' : ' '} ${p.id.padEnd(12)} ${p.version.padEnd(8)} ${p.description}`).join('\n');
}

export function formatOpinions(list: OpinionListing[]): string {
  return list.map(o => `${o.id.padEnd(34)} ${o.rung.padEnd(9)} ${(o.check ?? 'none').padEnd(8)} ${o.summary}`).join('\n');
}
