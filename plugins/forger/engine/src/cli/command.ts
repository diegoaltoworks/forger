/**
 * The shape of one CLI command and what it is handed. A command declares the
 * stage it needs; the context reaches that stage before the handler runs, in
 * the order root, config, backlog, runner, so a command fails the same way
 * whichever of them it reads.
 */

import type {Backlog} from '../backlog';
import type {WorkloopConfig} from '../config';
import type {AutomationRunner} from '../loop';
import type {AgentRunner, CommandRunner} from '../ports';
import type {FlagName, Values} from './flags';

export interface CliDeps {
  run?: CommandRunner;
  /** Stands in for the harness's agent, so a command that spawns one can be tested. */
  agent?: AgentRunner;
  installedSkills?: () => string[];
  collectionRoots?: () => string[];
}

/** none: runs anywhere; root: needs the consumer repo; config: and its config; loop: and the backlog and runner. */
export type Stage = 'none' | 'root' | 'config' | 'loop';

export const STAGES: Stage[] = ['none', 'root', 'config', 'loop'];

export interface CommandContext {
  values: Values;
  positionals: string[];
  deps: CliDeps;
  pluginRoot: string;
  installedSkills: () => string[];
  collectionRoots: () => string[];
  /** The injected runner, else real git and gh in the project root. */
  run(): CommandRunner;
  readonly projectRoot: string;
  readonly config: WorkloopConfig;
  readonly backlog: Backlog;
  readonly runner: AutomationRunner;
}

export interface Command {
  name: string;
  needs: Stage;
  flags: FlagName[];
  /** The command's lines in the usage text, verbatim. */
  help: string;
  run(ctx: CommandContext): void | Promise<void>;
}
