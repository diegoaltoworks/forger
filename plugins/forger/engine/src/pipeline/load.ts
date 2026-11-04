import {existsSync, readdirSync, readFileSync} from 'fs';
import {join} from 'path';

import {parseFlavour, parseFlavourRef, checkPin} from './flavour';
import type {Definition, Flavour} from './types';

export const OVERLAY_FILE = 'pipeline.json';

/** The definition the plugin ships. Throws when it is missing or malformed: the plugin is broken, not the project. */
export function loadDefinition(pluginRoot: string): Definition {
  const path = join(pluginRoot, 'pipeline', 'default.json');
  const data = JSON.parse(readFileSync(path, 'utf-8')) as Definition;
  if (!Array.isArray(data.stages)) throw new Error(`${path}: stages must be a list`);
  return data;
}

/** The project's overlay, or undefined when it has none. A file that does not parse is an error naming it. */
export function loadOverlay(forgerDir: string): unknown {
  const path = join(forgerDir, OVERLAY_FILE);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    throw new Error(`${path}: ${(e as Error).message}`);
  }
}

export const FLAVOURS_DIR = 'flavours';

/** Every flavour file in a directory, parsed; a file that is malformed is an error naming it. */
export function listFlavours(dir: string): Flavour[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => {
      const path = join(dir, f);
      let data: unknown;
      try {
        data = JSON.parse(readFileSync(path, 'utf-8'));
      } catch (e) {
        throw new Error(`${path}: ${(e as Error).message}`);
      }
      return parseFlavour(data, path);
    });
}

/** The flavour shipped with the plugin under this name, or undefined. */
export function shippedFlavour(pluginRoot: string, name: string): Flavour | undefined {
  return listFlavours(join(pluginRoot, FLAVOURS_DIR)).find(f => f.name === name);
}

/**
 * The flavour the config names: the project's own (`<forgerDir>/flavours`) before a shipped one.
 * Throws when none has that name or the pinned version is not the one found.
 */
export function loadFlavour(pluginRoot: string, forgerDir: string, ref: string): Flavour {
  const parsed = parseFlavourRef(ref);
  const found =
    listFlavours(join(forgerDir, FLAVOURS_DIR)).find(f => f.name === parsed.name) ?? shippedFlavour(pluginRoot, parsed.name);
  if (!found) throw new Error(`no flavour named "${parsed.name}" in ${join(forgerDir, FLAVOURS_DIR)} or the plugin`);
  const bad = checkPin(parsed, found);
  if (bad !== null) throw new Error(bad);
  return found;
}
