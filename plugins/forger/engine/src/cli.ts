/**
 * CLI entry. Finds the consumer repo root (nearest ancestor with a .claude
 * directory), loads its config, and dispatches to the runner.
 */

import {existsSync} from 'fs';
import {dirname, join} from 'path';
import {parseArgs} from 'util';

import {loadConfig} from './config';
import {AutomationRunner} from './runner';

/** Nearest ancestor directory containing a `.claude` folder. */
export function findProjectRoot(start: string = process.cwd()): string {
  let dir = start;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, '.claude'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('Could not find a .claude directory in this or any parent directory');
}

const HELP = `
work loop runner

Usage (run from the consumer repo root):
  run [N]          Run N iterations (default: 1)
  run --continuous Run until all tasks complete
  status           Show current status
  reset            Reset state to start fresh
  watch            Live status display
  resume           Clear HALT and resume
  halt [reason]    Manually halt automation

Stopping behaviour:
  - Stops after N iterations (enforced per session)
  - Stops if no progress for maxStallIterations (stall detection)
  - Stops if the HALT file exists
  - Stops on maxConsecutiveFailures consecutive failures

Config: .claude/workloop.config.json in the consumer repo (see plugin README).
`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const {values, positionals} = parseArgs({
    args: argv,
    options: {
      iterations: {type: 'string', short: 'n', default: '1'},
      continuous: {type: 'boolean', default: false},
      help: {type: 'boolean', short: 'h', default: false},
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  const command = positionals[0] || 'status';
  const projectRoot = findProjectRoot();
  const config = loadConfig(projectRoot);
  const runner = new AutomationRunner(projectRoot, config);

  switch (command) {
    case 'run': {
      const iterationArg = positionals[1] || (values.iterations as string);
      await runner.run(parseInt(iterationArg, 10), values.continuous as boolean);
      break;
    }
    case 'status':
      runner.showStatus();
      break;
    case 'reset':
      runner.resetState();
      break;
    case 'watch':
      await runner.watch();
      break;
    case 'resume':
      runner.clearHalt();
      console.log('Halt cleared. You can now run automation again.');
      runner.showStatus();
      break;
    case 'halt':
      runner.halt(positionals[1] || 'Manual halt');
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exitCode = 1;
  }
}
