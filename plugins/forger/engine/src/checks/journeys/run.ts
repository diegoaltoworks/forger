/**
 * The I/O half of `check journeys`: starts the app when the config says so,
 * waits for it, runs each journey's command in order and stops the app, even
 * when a journey fails. Every command goes through the injected runner.
 */

import {existsSync, readFileSync} from 'fs';

import {forgerPath} from '../../config';
import type {CommandRunner} from '../../ports';
import type {Gap} from '../gaps';
import type {Finding} from '../waivers';
import {
  JOURNEYS_PATH,
  exitShellCommand,
  judgeJourney,
  judgeReady,
  judgeStart,
  namedGaps,
  parseJourneysConfig,
  parsePid,
  startShellCommand,
  stopShellCommand,
  waitShellCommand,
  type JourneysConfig,
} from './journeys';

export function loadJourneysConfig(projectRoot: string): JourneysConfig {
  const file = forgerPath(projectRoot, JOURNEYS_PATH);
  if (!existsSync(file)) throw new Error(`${JOURNEYS_PATH} not found; the journeys pack's config is required`);
  return parseJourneysConfig(readFileSync(file, 'utf-8'));
}

/** The journeys of a project; none when it has no config, so `facts --guards` works without the pack. */
export function journeysOf(projectRoot: string): JourneysConfig['journeys'] {
  return existsSync(forgerPath(projectRoot, JOURNEYS_PATH)) ? loadJourneysConfig(projectRoot).journeys : [];
}

function runJourneys(config: JourneysConfig, run: CommandRunner): Finding[] {
  let pid: number | null = null;
  try {
    if (config.start !== undefined) {
      pid = parsePid(run(startShellCommand(config.start)));
      if (pid === null) return judgeStart(config);
    }
    if (config.ready !== undefined) {
      const notReady = judgeReady(config, run(waitShellCommand(config.ready, config.ready_seconds)));
      if (notReady.length > 0) return notReady;
    }
    return config.journeys.flatMap(j => judgeJourney(j, run(exitShellCommand(j.command))));
  } finally {
    if (pid !== null) run(stopShellCommand(pid));
  }
}

export function runJourneysCheck(projectRoot: string, run: CommandRunner): {findings: Finding[]; gaps: Gap[]} {
  const config = loadJourneysConfig(projectRoot);
  if (config.journeys.length === 0) return {findings: [], gaps: namedGaps(config)};
  return {findings: runJourneys(config, run), gaps: []};
}
