import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import type {Definition} from './types';

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
