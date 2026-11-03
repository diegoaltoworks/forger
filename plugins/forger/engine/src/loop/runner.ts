/**
 * The outer loop: the single-runner lock, the halt, stall and failure limits
 * that decide whether another iteration starts, and the status and watch
 * displays. One iteration itself lives in `iteration.ts`. The agent spawn and
 * the git runner are handed in, so the loop can be driven in a test without a
 * real agent or repo.
 */

import {existsSync, mkdirSync} from 'fs';
import {join} from 'path';

import type {WorkloopConfig} from '../config';
import type {Backlog} from '../backlog';
import type {AgentRunner, CommandRunner} from '../ports';
import {type AutomationState, currentTicket, StateStore} from './state';
import {Logger, colors} from './logger';
import {RateLimitError, rateLimitWaitMs} from './infra';
import {type IterationContext, closeOrphan, runIteration} from './iteration';
import {pidAlive, RunnerLock} from './lock';
import {appendEvent, terminalEvent, type TerminalEventKind} from './events';
import {buildStatus, type StatusReport} from './status-report';

export interface RunnerDeps {
  /** The agent spawn; a runner built without one can report and watch, but refuses to run an iteration. */
  agent?: AgentRunner;
  gitRunner: CommandRunner;
  uuid?: () => string;
  /** Liveness probe for the lock holder; defaults to a signal-0 check. */
  isAlive?: (pid: number) => boolean;
  pid?: number;
  /** Clock and wait, injectable so a rate-limit wait runs in a test without waiting. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
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
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private iteration: IterationContext;

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
    this.isAliveFn = deps.isAlive ?? pidAlive;
    this.lock = new RunnerLock(p(config.paths.lock), deps.pid, this.isAliveFn);

    this.gitRunner = deps.gitRunner;
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

  private emit(kind: TerminalEventKind, iteration: number, ticket: string | null, reason: string | null): void {
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
    if (this.store.isHalted()) {
      this.store.clearHalt();
      this.logger.log('INFO', 'Cleared HALT file');
    }
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

  runIteration(iteration: number, countStall = true): Promise<boolean> {
    return runIteration(this.iteration, iteration, countStall);
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
      await this.loop(iterations, continuous);
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
