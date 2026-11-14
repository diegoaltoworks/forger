import {execSync} from 'child_process';
import {existsSync, readFileSync} from 'fs';
import {dirname, isAbsolute, join, resolve} from 'path';

import {gitStateStore, localStateFor} from '../adapters';
import {isProjectRoot, loadConfig, type WorkloopConfig} from '../config';
import {decideSupervisor, decideWorker, DEFAULT_POLICY, HOOKS_POLICY_PATH, parseHookPolicy, toolCalls, type HookDecision, type HookPayload, type HookPolicy, type ToolCall} from '../hooks';
import {eventLine, RunnerLock, terminalEvent, workerIdentity, workerWorktree, type TerminalEvent} from '../loop';
import type {Command} from './command';

/** What the hook reads of the world, so a test hands in its own. */
export interface HookIo {
  /** Runs a git command in `cwd`; null when it fails. */
  git(cwd: string, args: string): string | null;
  readFile(path: string): string | null;
  engineAlive(loopRoot: string, config: WorkloopConfig): boolean;
  appendEvent(loopRoot: string, config: WorkloopConfig, event: TerminalEvent): void;
}

export interface HookInput extends HookPayload {
  cwd?: unknown;
}

export interface HookRun {
  decision: HookDecision;
  role: 'worker' | 'supervisor' | 'none';
  /** Why a refused call was not recorded, when it was not. */
  recordError?: string;
}

function nearestRoot(start: string): string | null {
  let dir = start;
  for (;;) {
    if (isProjectRoot(dir)) return dir;
    if (dir === dirname(dir)) return null;
    dir = dirname(dir);
  }
}

/** The main checkout of the repository `cwd` is in: a worktree's shares its git directory with it. */
export function loopRootOf(io: HookIo, cwd: string, fallback: string): string {
  const common = io.git(cwd, 'rev-parse --path-format=absolute --git-common-dir');
  const root = common ? dirname(common.trim()) : null;
  return root && isProjectRoot(root) ? root : fallback;
}

/** The policy the loop's checkout holds; a missing or broken one is the default, which `check hooks` reports. */
function policyAt(io: HookIo, loopRoot: string): HookPolicy {
  const text = io.readFile(join(loopRoot, HOOKS_POLICY_PATH));
  if (text === null) return DEFAULT_POLICY;
  try {
    return parseHookPolicy(text);
  } catch {
    return DEFAULT_POLICY;
  }
}

export function statePaths(config: WorkloopConfig): string[] {
  const {state, events, halt, lock, verdicts, checks} = config.paths;
  return [state, events, halt, lock, verdicts, checks, join(dirname(state), 'lease.json'), join(dirname(state), 'events')];
}

/** One hook call: the role from the environment, the facts from the checkout, the decision, and a refusal recorded. */
export function runHook(input: HookInput, env: Record<string, string | undefined>, io: HookIo, now: Date = new Date()): HookRun {
  const allow: HookRun = {decision: {allow: true}, role: 'none'};
  const calls = toolCalls(input);
  if (calls.length === 0) return allow;
  const cwd = typeof input.cwd === 'string' && isAbsolute(input.cwd) ? input.cwd : process.cwd();
  const projectRoot = nearestRoot(cwd);
  if (projectRoot === null) return allow;
  const loopRoot = loopRootOf(io, cwd, projectRoot);
  const config = loadConfig(loopRoot);
  const worker = workerIdentity(env);
  if (!worker) {
    const facts = {engineAlive: io.engineAlive(loopRoot, config), cwd, loopRoot, worktreesDir: join(loopRoot, dirname(config.paths.state), 'worktrees')};
    const refused = calls.map(call => decideSupervisor(call, facts)).find(d => !d.allow);
    return {decision: refused ?? {allow: true}, role: 'supervisor'};
  }
  const branch = io.git(cwd, 'branch --show-current')?.trim() || null;
  const policy = policyAt(io, loopRoot);
  const worktree = workerWorktree(env);
  const facts = {baseBranch: config.base_branch, currentBranch: branch, statePaths: statePaths(config), ...(worktree ? {worktree: {path: worktree, loopRoot, cwd}} : {})};
  const decision = calls.map((call: ToolCall) => decideWorker(policy, call, facts)).find(d => !d.allow) ?? {allow: true as const};
  if (decision.allow) return {decision, role: 'worker'};
  try {
    io.appendEvent(loopRoot, config, terminalEvent('worker_denied', worker.iteration, worker.ticket, `${decision.rule}: ${decision.command}`, now));
    return {decision, role: 'worker'};
  } catch (e) {
    return {decision, role: 'worker', recordError: (e as Error).message};
  }
}

export const realHookIo: HookIo = {
  git(cwd, args) {
    try {
      return execSync(`git ${args}`, {cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore']});
    } catch {
      return null;
    }
  },
  readFile: path => (existsSync(path) ? readFileSync(path, 'utf-8') : null),
  engineAlive: (loopRoot, config) => new RunnerLock(resolve(loopRoot, config.paths.lock)).liveHolder() !== null,
  appendEvent(loopRoot, config, event) {
    const store = config.state.home === 'branch' ? gitStateStore({repo: loopRoot, branch: config.state.branch}) : localStateFor(loopRoot, config);
    store.appendEvent(eventLine(event), new Date(event.at));
  },
};

export const hook: Command = {
  name: 'hook',
  needs: 'none',
  flags: [],
  help: `  hook             The harness's PreToolUse hook: reads the tool call as JSON on stdin and exits 2
                   with what to do instead when the call breaks .forger/hooks.json (a worker) or, while
                   an engine is alive, changes git state in the loop's checkout (anyone else).
                   A worker's refusal is recorded as a worker_denied event`,
  run() {
    let input: HookInput;
    try {
      input = JSON.parse(readFileSync(0, 'utf-8')) as HookInput;
    } catch {
      return;
    }
    const result = runHook(input, process.env, realHookIo);
    if (result.recordError) console.error(`forger hook: the refusal was not recorded: ${result.recordError}`);
    if (!result.decision.allow) {
      console.error(result.decision.message);
      process.exitCode = 2;
    }
  },
};
