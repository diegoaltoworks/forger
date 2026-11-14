/**
 * CLI entry. Finds the consumer repo root (nearest ancestor holding forger's
 * folder), loads its config, and dispatches to the command named on the
 * command line. This is the composition root: the only place the real command
 * runner and agent spawn are handed to the core.
 */

import {homedir, hostname} from 'os';
import {realpathSync} from 'fs';
import {resolve} from 'path';
import {parseArgs} from 'util';

import {agentFor, execCapture, sandboxFor, sandboxSite, gitStateStore, localStateFor, execRunner, execProbe, findHarness} from '../adapters';
import type {Backlog} from '../backlog';
import {detectLayout, isProjectRoot, legacyWarning, loadConfig, resolveProjectRoot, type WorkloopConfig} from '../config';
import {AutomationRunner, DEFAULT_LEASE_TTL_SECONDS, GhTrackerHalt, type LeaseSettings} from '../loop';
import {capturing, type StateStore} from '../ports';
import {listCollectionRoots, listInstalledSkills} from '../packs';
import {STAGES, type CliDeps, type CommandContext, type Stage} from './command';
import {FLAGS} from './flags';
import {openBacklog} from './open-backlog';
import {storedPlanFor} from './pipeline';
import {findCommand, renderHelp} from './registry';

/** The git top-level of a directory, or null when it is not inside a repository. */
export function gitTopLevel(dir: string): string | null {
  const out = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {cwd: dir, stdout: 'pipe', stderr: 'ignore'});
  const top = out.exitCode === 0 ? out.stdout.toString().trim() : '';
  return top ? realpathSync(top) : null;
}

/** The git top-level of `start`; outside a repository, the nearest ancestor holding forger's folder. Never the home directory. */
export function findProjectRoot(start: string = process.cwd(), home: string = homedir()): string {
  const root = resolveProjectRoot(start, {gitTop: gitTopLevel(start), home: realpathSync(home), isRoot: isProjectRoot});
  if (root === null) throw new Error('Could not find a git repository or a .forger directory in this or any parent directory');
  return root;
}

/** The lease identity of this engine when the state lives on the branch; none for the local store. */
function leaseSettingsFor(config: WorkloopConfig): LeaseSettings | undefined {
  if (config.state.home !== 'branch') return undefined;
  return {self: `${hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`, host: hostname(), ttlSeconds: DEFAULT_LEASE_TTL_SECONDS};
}

function contextFor(base: Pick<CommandContext, 'values' | 'positionals' | 'deps' | 'pluginRoot' | 'installedSkills' | 'collectionRoots'>): CommandContext {
  let root: string | undefined;
  let config: WorkloopConfig | undefined;
  let backlog: Backlog | undefined;
  let runner: AutomationRunner | undefined;
  let store: StateStore | undefined;
  const ctx: CommandContext = {
    ...base,
    run: () => base.deps.run ?? execRunner(ctx.projectRoot),
    capture: () => (base.deps.run ? capturing(base.deps.run) : execCapture(ctx.projectRoot)),
    get projectRoot() {
      return (root ??= findProjectRoot());
    },
    get config() {
      if (!config) {
        const warning = legacyWarning(detectLayout(ctx.projectRoot));
        if (warning) console.error(warning);
        config = loadConfig(ctx.projectRoot);
      }
      return config;
    },
    get backlog() {
      return (backlog ??= openBacklog(ctx.projectRoot, ctx.config, base.deps.run));
    },
    get stateStore() {
      if (base.deps.stateStore) return base.deps.stateStore;
      const from = base.values.from ?? ctx.config.state.home;
      if (from !== 'local' && from !== 'branch') throw new Error('--from must be local or branch');
      return (store ??= from === 'branch' ? gitStateStore({repo: ctx.projectRoot, branch: ctx.config.state.branch}) : localStateFor(ctx.projectRoot, ctx.config));
    },
    get runner() {
      const box = sandboxFor(ctx.config.sandbox, execCapture(ctx.projectRoot), sandboxSite(ctx.config, ctx.projectRoot, ctx.pluginRoot));
      return (runner ??= new AutomationRunner(ctx.projectRoot, ctx.config, ctx.backlog, {stateStore: ctx.stateStore, lease: leaseSettingsFor(ctx.config), gitRunner: execRunner(ctx.projectRoot), gitCapture: execCapture(ctx.projectRoot), probeRunner: execProbe, sandbox: box, agent: agentFor(findHarness(ctx.config.harness), ctx.config.model_prices, box), pluginRoot: ctx.pluginRoot, resolvePlan: ticket => storedPlanFor(ctx, ticket), haltTracker: ctx.config.tracker.kind === 'github' ? new GhTrackerHalt(execRunner(ctx.projectRoot)) : undefined}));
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
    pluginRoot: deps.pluginRoot ?? resolve(import.meta.dir, '../../..'),
    installedSkills: deps.installedSkills ?? (() => listInstalledSkills(homedir(), process.cwd())),
    collectionRoots: deps.collectionRoots ?? (() => listCollectionRoots(homedir())),
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
