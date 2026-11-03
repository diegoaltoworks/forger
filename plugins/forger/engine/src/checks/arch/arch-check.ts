/**
 * The I/O half of `check arch`: reads the layer map and the project's source
 * files (see `projectFiles`), then hands them to the pure checker. A missing or
 * malformed layer map is an error, never an empty pass.
 */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {ARCH_PATH, EXTRACTORS, checkArch, extractorFor, parseArchConfig, type SourceFile} from './arch';
import {moduleReadmeFindings, publicEntryFindings} from './modules';
import type {CommandRunner} from '../../ports';
import {projectFiles} from '../files';
import type {Finding} from '../waivers';
import {forgerPath} from '../../config';

export function runArchCheck(projectRoot: string, run: CommandRunner): Finding[] {
  const configPath = forgerPath(projectRoot, ARCH_PATH);
  if (!existsSync(configPath)) throw new Error(`${ARCH_PATH} not found; the architecture pack's layer map is required`);
  const config = parseArchConfig(readFileSync(configPath, 'utf-8'));
  const files: SourceFile[] = [];
  const tracked = projectFiles(run).filter(path => existsSync(join(projectRoot, path)));
  for (const path of tracked) {
    if (!extractorFor(path, EXTRACTORS)) continue;
    files.push({path, text: readFileSync(join(projectRoot, path), 'utf-8')});
  }
  return [...checkArch(files, config), ...moduleReadmeFindings(tracked, config), ...publicEntryFindings(files, config)];
}
