/**
 * CLI entry. Finds the consumer repo root (nearest ancestor with a .claude
 * directory), loads its config, and dispatches to the runner.
 */

import {existsSync} from 'fs';
import {homedir} from 'os';
import {dirname, join, resolve} from 'path';
import {parseArgs} from 'util';

import {loadConfig} from './config';
import {execRunner, type CommandRunner} from './git';
import {formatBacklogReport} from './backlog';
import {openBacklog} from './open-backlog';
import {runDocsCheck} from './docs-check';
import {formatViolations} from './docs-rules';
import {AutomationRunner} from './runner';
import {formatSetup, runSetup} from './setup';
import {formatSkills, listInstalledSkills, loadPresets, offerPresets, resolveSkills} from './skills';

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
  status [--json] Show current status, runner pid and liveness
  setup [--json] [--gates CMD] [--base-branch B] [--tracker KIND] [--preset NAME]
                   Install forger's default files into .claude/, never overwriting
  skills [--json] [--presets]
                   Resolve each skill slot to its configured skill and the built-in fallback;
                   --presets lists the presets whose skill collection is installed
  check docs [--json] Fail on non-ASCII punctuation, emails, home paths, denylist terms
  backlog [--json] Workable tickets in order, remaining count and next pick
  reset            Reset state to start fresh
  watch            Live status display
  resume           Clear HALT and resume
  halt [reason]    Manually halt automation

Only one runner works a repo at a time: a second run refuses while the
runner named in the lock file is alive.

Stopping behaviour:
  - Stops after N iterations (enforced per session)
  - Stops if no progress for maxStallIterations (stall detection)
  - Stops if the HALT file exists
  - Stops on maxConsecutiveFailures consecutive failures

Config: .claude/workloop.config.json in the consumer repo (see plugin README).
`;

export async function main(
  argv: string[] = process.argv.slice(2),
  deps: {run?: CommandRunner; installedSkills?: () => string[]} = {}
): Promise<void> {
  const {values, positionals} = parseArgs({
    args: argv,
    options: {
      iterations: {type: 'string', short: 'n', default: '1'},
      continuous: {type: 'boolean', default: false},
      json: {type: 'boolean', default: false},
      gates: {type: 'string'},
      'base-branch': {type: 'string'},
      tracker: {type: 'string'},
      preset: {type: 'string'},
      presets: {type: 'boolean', default: false},
      help: {type: 'boolean', short: 'h', default: false},
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  const command = positionals[0] || 'status';
  const pluginRoot = resolve(import.meta.dir, '../..');
  const installedSkills = deps.installedSkills ?? (() => listInstalledSkills(homedir(), process.cwd()));
  if (command === 'setup') {
    let skills: Record<string, string> | undefined;
    if (values.preset) {
      const preset = loadPresets(pluginRoot).find(p => p.name === values.preset);
      if (!preset) {
        console.error(`Unknown preset: ${values.preset}`);
        process.exitCode = 1;
        return;
      }
      skills = preset.skills;
    }
    const result = runSetup(process.cwd(), pluginRoot, {
      gates: values.gates,
      baseBranch: values['base-branch'],
      trackerKind: values.tracker,
      skills,
    });
    const offered = offerPresets(loadPresets(pluginRoot), installedSkills());
    console.log(values.json ? JSON.stringify({...result, presets: offered.map(p => p.name)}) : formatSetup(result, offered.map(p => p.name)));
    return;
  }
  const projectRoot = findProjectRoot();
  if (command === 'check') {
    if (positionals[1] !== 'docs') {
      console.error('Usage: check docs [--json]');
      process.exitCode = 1;
      return;
    }
    const violations = runDocsCheck(projectRoot, deps.run ?? execRunner(projectRoot));
    console.log(values.json ? JSON.stringify(violations) : formatViolations(violations));
    if (violations.length > 0) process.exitCode = 1;
    return;
  }
  const config = loadConfig(projectRoot);
  if (command === 'skills') {
    const installed = installedSkills();
    const out = values.presets ? offerPresets(loadPresets(pluginRoot), installed) : resolveSkills(config.skills, installed);
    if (values.json) console.log(JSON.stringify(out));
    else if (values.presets) console.log((out as ReturnType<typeof offerPresets>).map(p => `${p.name}: ${p.description}`).join('\n') || 'no preset matches an installed skill collection');
    else console.log(formatSkills(out as ReturnType<typeof resolveSkills>));
    return;
  }
  const backlog = openBacklog(projectRoot, config, deps.run);
  const runner = new AutomationRunner(projectRoot, config, backlog);

  switch (command) {
    case 'run': {
      const iterationArg = positionals[1] || (values.iterations as string);
      const started = await runner.run(parseInt(iterationArg, 10), values.continuous as boolean);
      if (!started) {
        console.error('Another runner is already running; not starting a second one.');
        process.exitCode = 1;
      }
      break;
    }
    case 'status':
      if (values.json) console.log(JSON.stringify(runner.statusReport()));
      else runner.showStatus();
      break;
    case 'backlog': {
      const report = backlog.report();
      console.log(values.json ? JSON.stringify(report) : formatBacklogReport(report));
      break;
    }
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
