/**
 * The I/O half of `check arch`: reads the layer map and the project's source
 * files (see `projectFiles`), then hands them to the pure checker. A missing or
 * malformed layer map is an error, never an empty pass.
 */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import {ARCH_OPINION, ARCH_PATH, EXTRACTORS, checkArch, extractorFor, layerOf, parseArchConfig, type ArchConfig, type SourceFile} from './arch';
import {moduleReadmeFindings, publicEntryFindings} from './modules';
import type {CommandRunner} from '../../ports';
import {projectFiles} from '../files';
import {unreadGaps, unreadSources, type Gap, type UnreadSource} from '../gaps';
import type {Finding} from '../waivers';
import {forgerPath} from '../../config';

function readConfig(projectRoot: string): ArchConfig {
  const configPath = forgerPath(projectRoot, ARCH_PATH);
  if (!existsSync(configPath)) throw new Error(`${ARCH_PATH} not found; the architecture pack's layer map is required`);
  return parseArchConfig(readFileSync(configPath, 'utf-8'));
}

/** Source files that sit in a declared layer and that no import extractor reads. */
export function unreadInLayers(paths: string[], config: ArchConfig): UnreadSource[] {
  return unreadSources(paths.filter(p => layerOf(p, config) !== null), p => extractorFor(p, EXTRACTORS) !== null);
}

/** The layer map's unread languages without running the check, for `setup` to report. */
export function archUnread(projectRoot: string, run: CommandRunner): UnreadSource[] {
  return unreadInLayers(projectFiles(run).filter(path => existsSync(join(projectRoot, path))), readConfig(projectRoot));
}

export function runArchCheckOutput(projectRoot: string, run: CommandRunner): {findings: Finding[]; gaps: Gap[]} {
  const config = readConfig(projectRoot);
  const files: SourceFile[] = [];
  const tracked = projectFiles(run).filter(path => existsSync(join(projectRoot, path)));
  for (const path of tracked) {
    if (!extractorFor(path, EXTRACTORS)) continue;
    files.push({path, text: readFileSync(join(projectRoot, path), 'utf-8')});
  }
  return {
    findings: [...checkArch(files, config), ...moduleReadmeFindings(tracked, config), ...publicEntryFindings(files, config)],
    gaps: unreadGaps(unreadInLayers(tracked, config), ARCH_OPINION),
  };
}

export function runArchCheck(projectRoot: string, run: CommandRunner): Finding[] {
  return runArchCheckOutput(projectRoot, run).findings;
}
