/**
 * Every CLI command, in the order the usage text lists them. The usage text is
 * generated from this list, so a command and its help cannot drift apart.
 */

import {approval} from './approval';
import {backlog} from './backlog';
import {brand} from './brand';
import {check} from './check';
import {contract} from './contract';
import {decline} from './decline';
import type {Command} from './command';
import {awaitEventCommand, events} from './events';
import {evalCommand} from './eval';
import {facts} from './facts';
import {halt, reset, resume, run, status, watch} from './loop';
import {handover} from './handover';
import {hook} from './hook';
import {intent} from './intent';
import {measure} from './measure';
import {merge} from './merge';
import {migrate} from './migrate';
import {opinions, packs} from './packs';
import {pipeline} from './pipeline';
import {prBody} from './pr-body';
import {retro} from './retro';
import {runLogged} from './run-logged';
import {screenshot} from './screenshot';
import {setup} from './setup';
import {skills} from './skills';
import {slice} from './slice';
import {orient, report} from './supervisor';
import {linkBlockersCommand} from './link-blockers';
import {recover} from './recover';
import {verify} from './verify';
import {critique} from './critique';
import {replay} from './replay';
import {rebase, worktree} from './worktree';

export const COMMANDS: Command[] = [
  run,
  status,
  setup,
  migrate,
  packs,
  opinions,
  skills,
  pipeline,
  contract,
  evalCommand,
  check,
  slice,
  intent,
  screenshot,
  brand,
  backlog,
  linkBlockersCommand,
  orient,
  report,
  facts,
  merge,
  verify,
  critique,
  replay,
  runLogged,
  decline,
  prBody,
  worktree,
  rebase,
  handover,
  approval,
  recover,
  events,
  awaitEventCommand,
  hook,
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

Config: .forger/workloop.config.json in the consumer repo (see plugin README).`;

export function renderHelp(commands: Command[] = COMMANDS): string {
  return `
work loop runner

Usage (run from the consumer repo root):
${commands.map(c => c.help).join('\n')}

${FOOTER}
`;
}
