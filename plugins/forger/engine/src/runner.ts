/**
 * The orchestration: the run loop, one iteration, and status/watch display. It
 * composes the pure modules (config, backlog, prompt, git, state) with the two
 * side-effect boundaries (logger, claude spawn). The interesting decisions have
 * been pushed into those pure modules; this file is the wiring and the control
 * flow. The claude spawn, git runner, and backlog are injectable so the
 * loop can be driven in a test without a real agent or repo.
 */

import {existsSync, mkdirSync, writeFileSync} from 'fs';
import {join} from 'path';

import type {WorkloopConfig} from './config';
import type {Backlog} from './backlog';
import {type CommandRunner, execRunner, verifyMerged} from './git';
import {buildPrompt} from './prompt';
import {type AutomationState, StateStore, stallUpdate} from './state';
import {Logger, colors} from './logger';
import {type ClaudeResult, type RunClaudeOptions, runClaude} from './claude';
import {formatIterationLog} from './iteration-log';
import {decideOutcome} from './outcome';
import {classifyExit} from './infra';
import {parseClaim} from './claim';
import {gatherFacts, takeSnapshot, ticketFromBranch} from './run-facts';

export interface RunnerDeps {
  runClaude?: (opts: RunClaudeOptions) => Promise<ClaudeResult>;
  gitRunner?: CommandRunner;
  uuid?: () => string;
}

export class AutomationRunner {
  private logger: Logger;
  private store: StateStore;
  private outputDir: string;
  private gitRunner: CommandRunner;
  private spawnClaude: (opts: RunClaudeOptions) => Promise<ClaudeResult>;
  private uuid: () => string;

  constructor(
    private projectRoot: string,
    private config: WorkloopConfig,
    private backlog: Backlog,
    deps: RunnerDeps = {}
  ) {
    const p = (rel: string): string => join(projectRoot, rel);
    this.logger = new Logger(p(config.paths.log));
    this.store = new StateStore(p(config.paths.state), p(config.paths.halt));
    this.outputDir = p(config.paths.output);

    this.gitRunner = deps.gitRunner ?? execRunner(projectRoot);
    this.spawnClaude = deps.runClaude ?? runClaude;
    this.uuid = deps.uuid ?? (() => crypto.randomUUID());

    if (!existsSync(this.outputDir)) mkdirSync(this.outputDir, {recursive: true});
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

  private verify(): string | null {
    const {state, log, output, halt} = this.config.paths;
    const ignore = [state, log, output, halt, ...this.config.local_only];
    return verifyMerged(this.gitRunner, this.config.base_branch, ignore);
  }

  halt(reason: string): void {
    this.store.writeHalt(reason);
    this.logger.log('WARN', `Created HALT file: ${reason}`);
    const state = this.store.load();
    state.status = 'halted';
    state.last_error = reason;
    this.store.save(state);
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

  async runIteration(iteration: number, countStall = true): Promise<boolean> {
    const state = this.store.load();
    const outputFile = join(this.outputDir, `iteration-${iteration}.log`);
    const sessionId = this.uuid();

    this.logger.log('INFO', `Starting iteration ${iteration}`);

    state.iteration = iteration;
    state.status = 'running';
    state.started_at = new Date().toISOString();
    state.session_id = sessionId;
    this.store.save(state);

    // Capture the ticket we are ABOUT to work before Claude runs. Reading it
    // afterwards records the *next* not-started ticket instead of the one just
    // implemented, so completed_tasks would lag a ticket behind.
    const attemptedTask = this.getNextTaskName();
    state.current_task = attemptedTask;
    this.store.save(state);

    const prompt = buildPrompt(this.config, iteration, state.completed_tasks);
    const tier = this.backlog.tier(attemptedTask);
    this.logger.log('INFO', `Running Claude (session: ${sessionId.slice(0, 8)}...)`);
    if (attemptedTask) {
      this.logger.log('INFO', `Ticket: ${attemptedTask} [${tier.model}, $${tier.budget}]`);
    }

    const {timeoutMinutes, killGraceSeconds, maxStallIterations} = this.config.limits;
    const base = this.config.base_branch;
    const snapshot = takeSnapshot(this.gitRunner, base);
    const startTime = Date.now();
    const result = await this.spawnClaude({
      prompt,
      sessionId,
      tier,
      cwd: this.projectRoot,
      timeoutMinutes,
      killGraceSeconds,
    });
    const duration = Math.round((Date.now() - startTime) / 1000);

    const gitFacts = gatherFacts(this.gitRunner, base, snapshot);
    // A branch that names no backlog ticket (a typo fix, a recovery branch)
    // leaves the run held to the engine's pick.
    const branchTicket = ticketFromBranch(gitFacts.branch);
    const taken = branchTicket && this.backlog.has(branchTicket) ? branchTicket : null;
    const ticket = taken ?? attemptedTask;
    if (taken && taken !== attemptedTask) {
      this.logger.log('INFO', `Worker took ${taken} (engine picked ${attemptedTask ?? 'none'})`);
    }

    writeFileSync(
      outputFile,
      formatIterationLog({
        iteration,
        ticket,
        enginePick: attemptedTask,
        elapsedSeconds: duration,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        timeoutMinutes,
        output: result.output,
      })
    );
    this.logger.log('INFO', `Claude finished in ${duration}s (exit: ${result.exitCode})`);

    const claim = parseClaim(result.output);
    const backlogCompleted = ticket !== null && this.backlog.isCompleted(ticket);
    const exit = classifyExit(result.exitCode, result.output, result.timedOut);
    const outcome = decideOutcome({
      ...gitFacts,
      infraError: exit.kind === 'infrastructure' ? exit.reason : null,
      ticket,
      claim: claim.claim,
      stopReason: claim.stopReason,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      timeoutMinutes,
      baseBranch: base,
      backlogCompleted,
      unclean: gitFacts.merged ? this.verify() : null,
    });

    state.status = outcome.status;
    if (outcome.result === 'success') {
      this.logger.log('SUCCESS', `Iteration ${iteration} merged ${ticket ?? 'a change'}`);
      state.last_completed_at = new Date().toISOString();
      state.completed_iterations++;
      state.consecutive_failures = 0;
      state.current_task = null;
      state.last_error = null;
      // Merged is the fact; the backlog naming the ticket completed is what
      // makes the name safe to feed the next prompt as history.
      if (ticket && backlogCompleted && !state.completed_tasks.includes(ticket)) {
        state.completed_tasks.push(ticket);
      }
    } else if (outcome.result === 'failure') {
      this.logger.log('ERROR', `Iteration ${iteration}: ${outcome.error}`);
      state.failed_iterations++;
      state.consecutive_failures++;
      state.last_error = outcome.error;
    } else {
      this.logger.log('WARN', `Iteration ${iteration} signaled STOP`);
    }
    if (outcome.warning) this.logger.log('WARN', `Iteration ${iteration}: ${outcome.warning}`);

    // The first iteration after a start has no earlier run in this session to
    // have stalled behind, so it is never counted.
    const stall = countStall
      ? stallUpdate(state.stall_count, outcome.merged, maxStallIterations)
      : {stall_count: state.stall_count, stalled: false};
    state.stall_count = stall.stall_count;
    this.store.save(state);

    if (outcome.halt) {
      this.halt(outcome.halt);
    } else if (stall.stalled) {
      const reason = `Stalled: nothing merged in ${maxStallIterations} iterations`;
      this.logger.log('ERROR', reason);
      this.halt(reason);
    } else if (!outcome.merged && countStall) {
      this.logger.log('WARN', `Nothing merged (stall ${stall.stall_count}/${maxStallIterations})`);
    }

    return outcome.result === 'success';
  }

  async run(iterations = 1, continuous = false): Promise<void> {
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
        break;
      }

      if (currentState.consecutive_failures >= maxConsecutiveFailures) {
        this.halt(`Too many consecutive failures (${maxConsecutiveFailures})`);
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

    refresh();
    const interval = setInterval(refresh, 2000);
    process.on('SIGINT', () => {
      clearInterval(interval);
      console.log('\nExiting watch mode');
      process.exit(0);
    });
    await new Promise(() => {});
  }

  showStatus(): void {
    const state = this.store.load();
    const remaining = this.getRemainingTasks();
    const halted = this.store.isHalted() || state.status === 'halted';
    const maxStall = this.config.limits.maxStallIterations;

    console.log('\n=== Automation Status ===');
    if (halted) console.log(`${colors.red}*** HALTED ***${colors.reset}`);
    console.log(`Status: ${state.status}`);
    console.log(`Iteration: ${state.iteration}`);
    console.log(`Completed: ${state.completed_iterations}`);
    console.log(`Failed: ${state.failed_iterations}`);
    console.log(`Consecutive failures: ${state.consecutive_failures}`);
    console.log(`Stall count: ${state.stall_count || 0}/${maxStall}`);
    console.log(`Remaining tasks: ${remaining} (${this.getWorkableCount()} workable now)`);
    console.log(`Next task: ${this.getNextTaskName() || 'none'}`);
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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
