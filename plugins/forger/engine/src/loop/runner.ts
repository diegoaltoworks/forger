/**
 * The outer loop: the single-runner lock, the halt, stall and failure limits
 * that decide whether another iteration starts, and the status and watch
 * displays. One iteration itself lives in `iteration.ts`. The agent spawn and
 * the git runner are handed in, so the loop can be driven in a test without a
 * real agent or repo.
 */

import {existsSync, mkdirSync, readdirSync, readFileSync} from 'fs';
import {join} from 'path';

import {forgerPath, type WorkloopConfig} from '../config';
import {pick, schedule, type Backlog, type FolderMap, type Schedulable} from '../backlog';
import {capturing, type AgentRunner, type CapturingRunner, type CommandRunner} from '../ports';
import {type AutomationState, currentTicket, StateStore} from './state';
import {Logger, colors} from './logger';
import {RateLimitError, rateLimitWaitMs} from './infra';
import {type IterationContext, type Placement, closeOrphan, runIteration} from './iteration';
import {conflictAfterAttempt, finishWorktree, folderMapFrom, inWorktree} from './parallel';
import {createWorktree, worktreePath} from './worktree';
import {pidAlive, RunnerLock} from './lock';
import {appendEvent, terminalEvent, type EventKind, type TerminalEventKind} from './events';
import {appendSchedule} from './schedule-log';
import {buildStatus, type StatusReport} from './status-report';

export interface RunnerDeps {
  /** The agent spawn; a runner built without one can report and watch, but refuses to run an iteration. */
  agent?: AgentRunner;
  gitRunner: CommandRunner;
  /** The git runner that reports failures, for worktrees; defaults to the plain runner seen as one that never fails. */
  gitCapture?: CapturingRunner;
  /** The folder map the scheduling rule reads; defaults to the architecture map of the project. */
  folderMap?: FolderMap;
  uuid?: () => string;
  /** Liveness probe for the lock holder; defaults to a signal-0 check. */
  isAlive?: (pid: number) => boolean;
  pid?: number;
  /** Clock and wait, injectable so a rate-limit wait runs in a test without waiting. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** How often a parallel loop looks for a finished worker or a HALT when none has finished. */
export const PARALLEL_POLL_MS = 1000;

/** The folder map from the project's architecture map; empty when there is none. */
export function loadFolderMap(projectRoot: string): FolderMap {
  let architecture: {modules?: {paths?: string[]}} | null = null;
  try {
    architecture = JSON.parse(readFileSync(forgerPath(projectRoot, '.forger/architecture.json'), 'utf-8'));
  } catch {
    architecture = null;
  }
  return folderMapFrom(architecture, root => {
    try {
      return readdirSync(join(projectRoot, root), {withFileTypes: true})
        .filter(e => e.isDirectory())
        .map(e => e.name);
    } catch {
      return [];
    }
  });
}

/** Watch redraws often; the backlog behind it is re-read only every this many redraws. */
export const WATCH_BACKLOG_EVERY = 30;

export class AutomationRunner {
  private logger: Logger;
  private store: StateStore;
  private outputDir: string;
  private gitRunner: CommandRunner;
  private agent: AgentRunner;
  private uuid: () => string;
  private lock: RunnerLock;
  private isAliveFn: (pid: number) => boolean;
  private eventsFile: string;
  private scheduleFile: string;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private iteration: IterationContext;
  private gitCapture: CapturingRunner;
  private folderMap: FolderMap | undefined;

  constructor(
    private projectRoot: string,
    private config: WorkloopConfig,
    private backlog: Backlog,
    deps: RunnerDeps
  ) {
    const p = (rel: string): string => join(projectRoot, rel);
    this.logger = new Logger(p(config.paths.log));
    this.store = new StateStore(p(config.paths.state), p(config.paths.halt));
    this.outputDir = p(config.paths.output);
    this.eventsFile = p(config.paths.events);
    this.scheduleFile = join(p(config.paths.output), 'schedule-decisions.jsonl');
    this.isAliveFn = deps.isAlive ?? pidAlive;
    this.lock = new RunnerLock(p(config.paths.lock), deps.pid, this.isAliveFn);

    this.gitRunner = deps.gitRunner;
    this.gitCapture = deps.gitCapture ?? capturing(deps.gitRunner);
    this.folderMap = deps.folderMap;
    this.agent = deps.agent ?? {run: () => Promise.reject(new Error('no agent runner was given to this runner'))};
    this.uuid = deps.uuid ?? (() => crypto.randomUUID());
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));

    if (!existsSync(this.outputDir)) mkdirSync(this.outputDir, {recursive: true});

    this.iteration = {
      projectRoot,
      config,
      backlog,
      store: this.store,
      logger: this.logger,
      outputDir: this.outputDir,
      gitRunner: this.gitRunner,
      agent: this.agent,
      uuid: this.uuid,
      refreshBacklog: () => this.refreshBacklog(),
      emit: (kind, iteration, ticket, reason) => this.emit(kind, iteration, ticket, reason),
      halt: (reason, kind) => this.halt(reason, kind),
    };
  }

  getRemainingTasks(): number {
    return this.backlog.remaining();
  }

  getWorkableCount(): number {
    return this.backlog.workableCount();
  }

  getNextTaskName(): string | null {
    return this.backlog.next();
  }

  /**
   * Re-read the backlog, waiting out a tracker rate limit instead of failing:
   * the limit is the platform's, so it is never charged to a ticket.
   */
  async refreshBacklog(): Promise<void> {
    while (true) {
      try {
        this.backlog.refresh();
        return;
      } catch (e) {
        if (!(e instanceof RateLimitError)) throw e;
        const wait = rateLimitWaitMs(e.window, this.now());
        this.logger.log('WARN', `${e.message}; waiting ${Math.ceil(wait / 1000)}s`);
        await this.sleep(wait);
      }
    }
  }

  private emit(kind: EventKind, iteration: number, ticket: string | null, reason: string | null): void {
    appendEvent(this.eventsFile, terminalEvent(kind, iteration, ticket, reason));
  }

  halt(reason: string, kind: TerminalEventKind = 'halted'): void {
    this.store.writeHalt(reason);
    this.logger.log('WARN', `Created HALT file: ${reason}`);
    const state = this.store.load();
    state.status = 'halted';
    state.last_error = reason;
    this.store.save(state);
    this.emit(kind, state.iteration, currentTicket(state), reason);
  }

  clearHalt(): void {
    const before = this.store.load();
    const wasHalted = this.store.isHalted() || before.status === 'halted';
    if (this.store.isHalted()) {
      this.store.clearHalt();
      this.logger.log('INFO', 'Cleared HALT file');
    }
    if (wasHalted) this.emit('halt_cleared', before.iteration, currentTicket(before), before.last_error);
    // The counters that tripped the halt would trip it again on the first
    // iteration after the human has fixed the cause.
    const state = this.store.load();
    if (state.status === 'halted') state.status = 'ready';
    state.consecutive_failures = 0;
    state.stall_count = 0;
    this.store.save(state);
  }

  resetState(): void {
    this.store.reset();
    this.logger.log('INFO', 'State reset complete');
  }

  runIteration(iteration: number, countStall = true, placement?: Placement): Promise<boolean> {
    return runIteration(this.iteration, iteration, countStall, placement);
  }

  /**
   * An iteration still marked running when no live runner holds the lock was
   * left open by a runner that died; it is settled from git, not re-run.
   */
  closeOrphan(): void {
    closeOrphan(this.iteration);
  }

  /**
   * Runs the loop. Returns false without doing anything when a live runner
   * already holds the lock.
   */
  async run(iterations = 1, continuous = false): Promise<boolean> {
    const lock = this.lock.acquire();
    if (!lock.ok) {
      const msg = `Another runner (pid ${lock.holder}) is already running. Not starting a second one.`;
      this.logger.log('ERROR', msg);
      return false;
    }
    if (lock.tookOver) {
      this.logger.log('WARN', `Took over a stale lock from dead runner (pid ${lock.tookOver})`);
    }
    try {
      await this.refreshBacklog();
      this.closeOrphan();
      if (this.config.parallelism > 1) await this.loopParallel(iterations, continuous);
      else await this.loop(iterations, continuous);
      return true;
    } finally {
      this.lock.release();
    }
  }

  private async loop(iterations: number, continuous: boolean): Promise<void> {
    if (this.store.isHalted()) {
      this.logger.log('ERROR', 'Automation is HALTED. Run "resume" to continue.');
      this.showStatus();
      return;
    }
    const initial = this.store.load();
    if (initial.status === 'halted') {
      this.logger.log('ERROR', 'Automation status is halted. Run "resume" to continue.');
      this.showStatus();
      return;
    }

    initial.stall_count = 0;
    this.store.save(initial);

    let iteration = initial.iteration;
    const sessionStartIteration = iteration;
    this.logger.log(
      'INFO',
      `Starting automation (${continuous ? 'continuous' : `${iterations} iterations`})`
    );

    let completed = 0;
    const {maxConsecutiveFailures, pauseAfterFailure, pauseBetweenIterations} = this.config.limits;

    while (true) {
      iteration++;

      if (this.store.isHalted()) {
        this.logger.log('WARN', 'HALT file detected. Stopping.');
        break;
      }

      const iterationsThisSession = iteration - sessionStartIteration;
      if (!continuous && iterationsThisSession > iterations) {
        this.logger.log('INFO', `Completed ${iterations} iterations (limit reached)`);
        break;
      }

      const remaining = this.getRemainingTasks();

      const currentState = this.store.load();

      if (remaining === 0) {
        this.logger.log('SUCCESS', 'All tasks completed!');
        this.emit('completed', currentState.iteration, null, null);
        break;
      }

      if (currentState.consecutive_failures >= maxConsecutiveFailures) {
        this.halt(`Too many consecutive failures (${maxConsecutiveFailures})`, 'too_many_failures');
        break;
      }

      this.logger.log('INFO', `Remaining tasks: ${remaining}`);

      if (await this.runIteration(iteration, iterationsThisSession > 1)) {
        completed++;
      } else {
        await this.sleep(pauseAfterFailure);
      }

      if (continuous || iterationsThisSession < iterations) {
        await this.sleep(pauseBetweenIterations);
      }
    }

    this.logger.log('INFO', `Completed ${completed} iterations`);
    this.showStatus();
  }

  /** Appends each candidate/running pair the rule judges, once, for the measures. */
  private recordVerdicts(candidates: Schedulable[], running: Schedulable[], map: FolderMap, judged: Set<string>): void {
    for (const c of candidates) {
      for (const r of running) {
        const key = `${c.id}|${r.id}`;
        if (judged.has(key)) continue;
        judged.add(key);
        const v = schedule(c, r, map, {graph: this.backlog.graph()});
        appendSchedule(this.scheduleFile, {at: new Date(this.now()).toISOString(), ticket: c.id, other: r.id, verdict: v.verdict, reason: v.reason});
      }
    }
  }

  /** The worktree, git runner and clean-up for one worker started on `ticket`. */
  private placeWorker(ticket: string, abort: AbortSignal): Placement | string {
    const stateDir = join(this.projectRoot, this.config.paths.state, '..');
    const o = {ticket, baseBranch: this.config.base_branch, stateDir};
    const made = createWorktree(this.gitCapture, o);
    if (!made.ok) return `worktree for ${ticket}: ${made.error}`;
    const cwd = worktreePath(stateDir, ticket);
    return {
      ticket,
      cwd,
      gitRunner: inWorktree(this.gitRunner, cwd),
      abort,
      conflicts: () => conflictAfterAttempt(this.gitCapture, o),
      finish: conflicted => {
        const failed = finishWorktree(this.gitCapture, o, conflicted);
        if (failed) this.logger.log('WARN', `Could not remove the worktree for ${ticket}: ${failed}`);
      },
    };
  }

  /**
   * The loop with workers side by side (ADR 0011): `pick` chooses the tickets
   * that may run together, each in its own worktree. One HALT stops new starts
   * and, after the kill grace, ends the workers still running; each worker
   * keeps its own timeout.
   */
  private async loopParallel(iterations: number, continuous: boolean): Promise<void> {
    if (this.store.isHalted()) {
      this.logger.log('ERROR', 'Automation is HALTED. Run "resume" to continue.');
      this.showStatus();
      return;
    }
    const initial = this.store.load();
    if (initial.status === 'halted') {
      this.logger.log('ERROR', 'Automation status is halted. Run "resume" to continue.');
      this.showStatus();
      return;
    }
    initial.stall_count = 0;
    this.store.save(initial);

    const {parallelism} = this.config;
    const {maxConsecutiveFailures, pauseAfterFailure, killGraceSeconds} = this.config.limits;
    const map = (this.folderMap ??= loadFolderMap(this.projectRoot));
    this.logger.log('INFO', `Starting automation (${continuous ? 'continuous' : `${iterations} iterations`}, up to ${parallelism} workers)`);

    const abort = new AbortController();
    const judged = new Set<string>();
    const running = new Map<string, {done: Promise<void>; scheduled: Schedulable}>();
    let iteration = initial.iteration;
    let started = 0;
    let completed = 0;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const start = (c: Schedulable): void => {
      iteration++;
      started++;
      const placed = this.placeWorker(c.id, abort.signal);
      if (typeof placed === 'string') {
        const state = this.store.load();
        state.failed_iterations++;
        state.consecutive_failures++;
        state.last_error = placed;
        this.store.save(state);
        this.logger.log('ERROR', placed);
        return;
      }
      const done = this.runIteration(iteration, started > 1, placed)
        .then(async ok => {
          if (ok) completed++;
          else await this.sleep(pauseAfterFailure);
        })
        .catch(e => this.logger.log('ERROR', `Worker for ${c.id} failed: ${(e as Error).message}`))
        .then(async () => {
          running.delete(c.id);
          await this.refreshBacklog();
        });
      running.set(c.id, {done, scheduled: c});
    };

    while (true) {
      if (this.store.isHalted()) {
        if (running.size === 0) {
          this.logger.log('WARN', 'HALT file detected. Stopping.');
          break;
        }
        if (killTimer === undefined) {
          this.logger.log('WARN', `HALT file detected; ending ${running.size} running worker(s) after ${killGraceSeconds}s`);
          killTimer = setTimeout(() => abort.abort(), killGraceSeconds * 1000);
        }
      } else {
        const state = this.store.load();
        const remaining = this.getRemainingTasks();
        if (remaining === 0 && running.size === 0) {
          this.logger.log('SUCCESS', 'All tasks completed!');
          this.emit('completed', state.iteration, null, null);
          break;
        }
        if (state.consecutive_failures >= maxConsecutiveFailures) {
          this.halt(`Too many consecutive failures (${maxConsecutiveFailures})`, 'too_many_failures');
          continue;
        }
        if (continuous || started < iterations) {
          const candidates = this.backlog.candidates().filter(c => !running.has(c.id));
          const together = [...running.values()].map(r => r.scheduled);
          this.recordVerdicts(candidates, together, map, judged);
          const chosen = pick(candidates, together, parallelism, map, {graph: this.backlog.graph()});
          for (const c of chosen.slice(0, continuous ? chosen.length : iterations - started)) start(c);
        }
        if (running.size === 0) {
          this.logger.log('INFO', started >= iterations && !continuous ? `Completed ${iterations} iterations (limit reached)` : 'No workable ticket to start');
          break;
        }
      }
      await Promise.race([...[...running.values()].map(r => r.done), this.sleep(PARALLEL_POLL_MS)]);
    }
    clearTimeout(killTimer);
    this.logger.log('INFO', `Completed ${completed} iterations`);
    this.showStatus();
  }

  /** Re-reads the backlog on every WATCH_BACKLOG_EVERY-th redraw; the error, if the read failed. */
  watchRefresh(redraw: number): string | null {
    if (redraw % WATCH_BACKLOG_EVERY !== 0) return null;
    try {
      this.backlog.refresh();
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  async watch(): Promise<void> {
    this.logger.log('INFO', 'Starting watch mode (Ctrl+C to stop)');

    const format = (state: AutomationState): string =>
      [
        '',
        '+-----------------------------------------+',
        '|            AUTOMATION STATUS            |',
        '+-----------------------------------------+',
        `| Status:      ${state.status.padEnd(26)}|`,
        `| Iteration:   ${String(state.iteration).padEnd(26)}|`,
        `| Completed:   ${String(state.completed_iterations).padEnd(26)}|`,
        `| Failed:      ${String(state.failed_iterations).padEnd(26)}|`,
        `| Remaining:   ${String(this.getRemainingTasks()).padEnd(26)}|`,
        `| Next:        ${(this.getNextTaskName() || 'none').slice(0, 26).padEnd(26)}|`,
        '+-----------------------------------------+',
      ].join('\n');

    const refresh = () => {
      console.clear();
      const state = this.store.load();
      console.log(format(state));
      if (state.last_error) {
        console.log(`\n${colors.red}Last error: ${state.last_error}${colors.reset}`);
      }
      if (state.completed_tasks.length > 0) {
        console.log(`\n${colors.green}Completed tasks:${colors.reset}`);
        state.completed_tasks.forEach(t => console.log(`  - ${t}`));
      }
      console.log('\nPress Ctrl+C to exit');
    };

    let redraws = 0;
    const tick = () => {
      const unread = this.watchRefresh(++redraws);
      refresh();
      if (unread) console.log(`${colors.yellow}Backlog not refreshed: ${unread}${colors.reset}`);
    };

    refresh();
    const interval = setInterval(tick, 2000);
    process.on('SIGINT', () => {
      clearInterval(interval);
      console.log('\nExiting watch mode');
      process.exit(0);
    });
    await new Promise(() => {});
  }

  statusReport(): StatusReport {
    const pid = this.lock.holder();
    return buildStatus({
      state: this.store.load(),
      isAlive: this.isAliveFn,
      runnerPid: pid,
      runnerAlive: this.lock.liveHolder() !== null,
      halted: this.store.isHalted(),
      remaining: this.getRemainingTasks(),
      workable: this.getWorkableCount(),
      next: this.getNextTaskName(),
      maxStallIterations: this.config.limits.maxStallIterations,
      maxConsecutiveFailures: this.config.limits.maxConsecutiveFailures,
    });
  }

  showStatus(): void {
    const state = this.store.load();
    const remaining = this.getRemainingTasks();
    const halted = this.store.isHalted() || state.status === 'halted';
    const maxStall = this.config.limits.maxStallIterations;

    console.log('\n=== Automation Status ===');
    if (halted) console.log(`${colors.red}*** HALTED ***${colors.reset}`);
    const holder = this.lock.holder();
    const live = this.lock.liveHolder() !== null;
    console.log(`Runner: ${holder === null ? 'none' : `pid ${holder} (${live ? 'alive' : 'dead'})`}`);
    console.log(`Status: ${state.status}`);
    console.log(`Iteration: ${state.iteration}`);
    console.log(`Completed: ${state.completed_iterations}`);
    console.log(`Failed: ${state.failed_iterations}`);
    console.log(`Consecutive failures: ${state.consecutive_failures}`);
    console.log(`Stall count: ${state.stall_count || 0}/${maxStall}`);
    console.log(`Remaining tasks: ${remaining} (${this.getWorkableCount()} workable now)`);
    console.log(`Next task: ${this.getNextTaskName() || 'none'}`);
    for (const run of state.in_flight) {
      console.log(`In flight: ${run.ticket ?? 'no ticket'} (pid ${run.pid ?? 'unknown'})`);
    }
    if (state.last_error) {
      console.log(`${colors.yellow}Last error: ${state.last_error}${colors.reset}`);
    }
    if (state.completed_tasks.length > 0) {
      console.log(`Completed tasks: ${state.completed_tasks.join(', ')}`);
    }
    if (halted) {
      console.log(`\n${colors.yellow}To resume: run the runner with "resume"${colors.reset}`);
    }
  }
}
