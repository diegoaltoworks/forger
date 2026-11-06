import {spawn} from 'child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';

import {credentialPlan, describeStart, dockerCheck, findHarness, parseEngineStart, planDetach, type EngineStart} from '../adapters';
import type {CommandContext} from './command';

export const ENGINE_START_FILE = 'engine-start.json';
export const ENGINE_IMAGE = 'forger-engine:base';

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function startFile(ctx: Pick<CommandContext, 'projectRoot' | 'config'>): string {
  return join(ctx.projectRoot, ctx.config.paths.output, ENGINE_START_FILE);
}

export function readEngineStart(ctx: Pick<CommandContext, 'projectRoot' | 'config'>): EngineStart | null {
  const file = startFile(ctx);
  return parseEngineStart(existsSync(file) ? readFileSync(file, 'utf-8') : null);
}

export function engineStartLine(ctx: Pick<CommandContext, 'projectRoot' | 'config'>): string {
  return `engine start: ${describeStart(readEngineStart(ctx))}`;
}

function record(ctx: CommandContext, start: EngineStart): void {
  const file = startFile(ctx);
  mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, JSON.stringify(start) + '\n');
}

/** Starts the engine so it outlives this session. Sets a failing exit code when it cannot. */
export function detachEngine(ctx: CommandContext): void {
  const {config, pluginRoot, projectRoot} = ctx;
  const run = ctx.capture();
  const dockerUp = dockerCheck(run('docker info --format {{.ServerVersion}}')).ok;
  const origin = run('git remote get-url origin').stdout.trim();
  const plan = credentialPlan(config, findHarness(config.harness));
  const passthrough = [...plan.variables, 'GH_TOKEN'].filter(v => process.env[v] !== undefined);
  const decided = planDetach({sandbox: config.sandbox, dockerUp, origin, baseBranch: config.base_branch, image: ENGINE_IMAGE, passthrough});
  if (decided.kind === 'refused') {
    console.error(`Not starting: ${decided.reason}.`);
    process.exitCode = 1;
    return;
  }
  if (decided.kind === 'container') {
    const sandboxDir = join(pluginRoot, 'sandbox');
    const base = run(`docker build -q -t forger-sandbox:base -f ${shellQuote(join(sandboxDir, 'Dockerfile'))} ${shellQuote(sandboxDir)}`);
    const built = base.exitCode === 0 ? run(`docker build -q -t ${ENGINE_IMAGE} -f ${shellQuote(join(sandboxDir, 'engine.Dockerfile'))} ${shellQuote(sandboxDir)}`) : base;
    if (built.exitCode !== 0) {
      console.error(`Not starting: building the engine image failed: ${built.stderr || built.stdout}`);
      process.exitCode = 1;
      return;
    }
    const existing = run(`docker inspect -f '{{.State.Running}}' ${shellQuote(decided.name)}`);
    if (existing.exitCode === 0 && existing.stdout.trim() === 'true') {
      console.error(`Not starting: the engine container ${decided.name} is already running.`);
      process.exitCode = 1;
      return;
    }
    run(`docker rm -f ${shellQuote(decided.name)}`);
    const started = run(`docker ${decided.args.map(shellQuote).join(' ')}`);
    if (started.exitCode !== 0) {
      console.error(`Not starting: docker run failed: ${started.stderr || started.stdout}`);
      process.exitCode = 1;
      return;
    }
    record(ctx, {mode: 'container', name: decided.name, image: decided.image});
    console.log(`engine started in container ${decided.name}`);
    return;
  }
  const spawnSession = ctx.deps.spawnSession ?? defaultSpawnSession;
  const pid = spawnSession([process.argv[0], join(pluginRoot, 'bin', 'work.ts'), 'run', '--continuous'], projectRoot);
  record(ctx, {mode: 'session', pid});
  console.log(`engine started in its own session, pid ${pid}`);
}

/** A new session and process group, with no stdio tied to this one, so ending the caller's session leaves it running. */
function defaultSpawnSession(argv: string[], cwd: string): number {
  const child = spawn(argv[0], argv.slice(1), {cwd, detached: true, stdio: 'ignore'});
  child.unref();
  return child.pid ?? 0;
}
