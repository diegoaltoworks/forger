/**
 * Every CLI command, in the order the usage text lists them. The usage text is
 * generated from this list, so a command and its help cannot drift apart.
 */

import {approval} from './approval';
import {backlog} from './backlog';
import {check} from './check';
import type {Command} from './command';
import {awaitEventCommand, events} from './events';
import {facts} from './facts';
import {halt, reset, resume, run, status, watch} from './loop';
import {measure} from './measure';
import {opinions, packs} from './packs';
import {retro} from './retro';
import {setup} from './setup';
import {skills} from './skills';
import {orient, report} from './supervisor';

export const COMMANDS: Command[] = [
  run,
  status,
  setup,
  packs,
  opinions,
  skills,
  check,
  backlog,
  orient,
  report,
  facts,
  approval,
  events,
  awaitEventCommand,
  measure,
  retro,
  reset,
  watch,
  resume,
  halt,
];

export function findCommand(name: string, commands: Command[] = COMMANDS): Command | undefined {
  return commands.find(c => c.name === name);
}

const FOOTER = `Only one runner works a repo at a time: a second run refuses while the
runner named in the lock file is alive.

Stopping behaviour:
  - Stops after N iterations (enforced per session)
  - Stops if no progress for maxStallIterations (stall detection)
  - Stops if the HALT file exists
  - Stops on maxConsecutiveFailures consecutive failures

Config: .claude/workloop.config.json in the consumer repo (see plugin README).`;

export function renderHelp(commands: Command[] = COMMANDS): string {
  return `
work loop runner

Usage (run from the consumer repo root):
${commands.map(c => c.help).join('\n')}

${FOOTER}
`;
}
