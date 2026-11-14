import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';

import {forgerPath} from '../../config';
import type {StarterManifest} from './choose';

const MANIFEST = 'starter.json';
const FORGER_PREFIX = '.forger/';
/** The default of the structure pack; kept here so the starter check does not depend on the config being installed yet. */
const DEFAULT_SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.rb', '.java', '.kt', '.swift', '.vue', '.svelte'];
const SKIPPED = new Set(['.git', 'node_modules', '.forger', '.claude', 'dist', 'build', 'target', 'vendor', '.venv']);

export interface StarterFile {
  path: string;
  action: 'written' | 'kept';
}

/** The starters the plugin ships, by name; an unreadable manifest is an error. */
export function loadStarters(pluginRoot: string): StarterManifest[] {
  const dir = join(pluginRoot, 'starters');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, {withFileTypes: true})
    .filter(e => e.isDirectory() && existsSync(join(dir, e.name, MANIFEST)))
    .map(e => JSON.parse(readFileSync(join(dir, e.name, MANIFEST), 'utf-8')) as StarterManifest)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** True when the repository holds a file with a source extension outside the vendored and generated folders. */
export function hasSourceFile(root: string): boolean {
  const walk = (rel: string): boolean =>
    readdirSync(join(root, rel), {withFileTypes: true}).some(e => {
      if (e.isDirectory()) return !SKIPPED.has(e.name) && walk(rel === '' ? e.name : `${rel}/${e.name}`);
      return e.isFile() && !e.name.endsWith('.d.ts') && DEFAULT_SOURCE_EXTENSIONS.some(x => e.name.endsWith(x));
    });
  return walk('');
}

function listFiles(dir: string, rel = ''): string[] {
  return readdirSync(join(dir, rel), {withFileTypes: true}).flatMap(e => {
    const path = rel === '' ? e.name : `${rel}/${e.name}`;
    return e.isDirectory() ? listFiles(dir, path) : [path];
  });
}

/** Copies the starter's files into the project, never overwriting one; `.forger/` files follow the project's layout. */
export function installStarter(projectRoot: string, pluginRoot: string, starter: StarterManifest): StarterFile[] {
  const dir = join(pluginRoot, 'starters', starter.name);
  return listFiles(dir)
    .filter(f => f !== MANIFEST)
    .sort()
    .map((f): StarterFile => {
      const target = f.startsWith(FORGER_PREFIX) ? forgerPath(projectRoot, f) : join(projectRoot, f);
      if (existsSync(target)) return {path: f, action: 'kept'};
      mkdirSync(dirname(target), {recursive: true});
      writeFileSync(target, readFileSync(join(dir, f)));
      return {path: f, action: 'written'};
    });
}
