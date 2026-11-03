/**
 * CLI entry. Finds the consumer repo root (nearest ancestor with a .claude
 * directory), loads its config, and dispatches to the command named on the
 * command line. This is the composition root: the only place the real command
 * runner and agent spawn are handed to the core.
 */

import {existsSync} from 'fs';
import {homedir} from 'os';
import {dirname, join, resolve} from 'path';
import {parseArgs} from 'util';

import {execRunner, claudeAgent} from '../adapters';
import type {Backlog} from '../backlog';
import {loadConfig, type WorkloopConfig} from '../config';
import {AutomationRunner} from '../loop';
import {listInstalledSkills} from '../packs';
import {STAGES, type CliDeps, type CommandContext, type Stage} from './command';
import {FLAGS} from './flags';
import {openBacklog} from './open-backlog';
import {findCommand, renderHelp} from './registry';

/** Nearest ancestor directory containing a `.claude` folder. */
export function findProjectRoot(start: string = process.cwd()): string {
  let dir = start;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, '.claude'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('Could not find a .claude directory in this or any parent directory');
}

function contextFor(base: Pick<CommandContext, 'values' | 'positionals' | 'deps' | 'pluginRoot' | 'installedSkills'>): CommandContext {
  let root: string | undefined;
  let config: WorkloopConfig | undefined;
  let backlog: Backlog | undefined;
  let runner: AutomationRunner | undefined;
  const ctx: CommandContext = {
    ...base,
    run: () => base.deps.run ?? execRunner(ctx.projectRoot),
    get projectRoot() {
      return (root ??= findProjectRoot());
    },
    get config() {
      return (config ??= loadConfig(ctx.projectRoot));
    },
    get backlog() {
      return (backlog ??= openBacklog(ctx.projectRoot, ctx.config, base.deps.run));
    },
    get runner() {
      return (runner ??= new AutomationRunner(ctx.projectRoot, ctx.config, ctx.backlog, {gitRunner: execRunner(ctx.projectRoot), agent: claudeAgent}));
    },
  };
  return ctx;
}

/** Reach a stage in order, so an earlier stage's error wins whatever the command reads first. */
function reach(ctx: CommandContext, stage: Stage): void {
  const at = STAGES.indexOf(stage);
  if (at >= STAGES.indexOf('root')) void ctx.projectRoot;
  if (at >= STAGES.indexOf('config')) void ctx.config;
  if (at >= STAGES.indexOf('loop')) void ctx.runner;
}

export async function main(argv: string[] = process.argv.slice(2), deps: CliDeps = {}): Promise<void> {
  const {values, positionals} = parseArgs({args: argv, options: FLAGS, allowPositionals: true});

  if (values.help) {
    console.log(renderHelp());
    return;
  }

  const name = positionals[0] || 'status';
  const ctx = contextFor({
    values,
    positionals,
    deps,
    pluginRoot: resolve(import.meta.dir, '../../..'),
    installedSkills: deps.installedSkills ?? (() => listInstalledSkills(homedir(), process.cwd())),
  });
  const command = findCommand(name);
  // An unknown name is reported only once the loop is reachable, as every loop command is.
  reach(ctx, command?.needs ?? 'loop');
  if (!command) {
    console.error(`Unknown command: ${name}`);
    process.exitCode = 1;
    return;
  }
  await command.run(ctx);
}
