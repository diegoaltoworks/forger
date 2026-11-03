/**
 * The orchestration: the run loop, one iteration, and status/watch display. It
 * composes the pure modules (config, backlog, prompt, git, state) with the two
 * side-effect boundaries (logger, claude spawn). The interesting decisions have
 * been pushed into those pure modules; this file is the wiring and the control
 * flow. The claude spawn, git runner, and backlog loader are injectable so the
 * loop can be driven in a test without a real agent or repo.
 */

import {existsSync, mkdirSync, readFileSync} from 'fs';
import {join} from 'path';

import type {WorkloopConfig} from './config';
import {
  type PRD,
  isTicketCompleted,
  nextTaskName,
  remainingTasks,
  tierFor,
  workableCount,
} from './backlog';
import {type CommandRunner, execRunner, verifyMerged} from './git';
import {buildPrompt} from './prompt';
import {type AutomationState, StateStore, stallUpdate} from './state';
import {Logger, colors} from './logger';
import {type ClaudeResult, type RunClaudeOptions, runClaude} from './claude';

export interface RunnerDeps {
  runClaude?: (opts: RunClaudeOptions) => Promise<ClaudeResult>;
  gitRunner?: CommandRunner;
  loadPRD?: () => PRD | null;
  uuid?: () => string;
}

export class AutomationRunner {
  private logger: Logger;
  private store: StateStore;
  private backlogFile: string;
  private outputDir: string;
  private gitRunner: CommandRunner;
  private spawnClaude: (opts: RunClaudeOptions) => Promise<ClaudeResult>;
  private loadPRDImpl: () => PRD | null;
  private uuid: () => string;

  constructor(
    private projectRoot: string,
    private config: WorkloopConfig,
    deps: RunnerDeps = {}
  ) {
    const p = (rel: string): string => join(projectRoot, rel);
    this.logger = new Logger(p(config.paths.log));
    this.store = new StateStore(p(config.paths.state), p(config.paths.halt));
    this.backlogFile = p(config.paths.backlog);
    this.outputDir = p(config.paths.output);

    this.gitRunner = deps.gitRunner ?? execRunner(projectRoot);
    this.spawnClaude = deps.runClaude ?? runClaude;
    this.loadPRDImpl = deps.loadPRD ?? (() => this.readBacklog());
    this.uuid = deps.uuid ?? (() => crypto.randomUUID());

    if (!existsSync(this.outputDir)) mkdirSync(this.outputDir, {recursive: true});
  }

  private readBacklog(): PRD | null {
    try {
      return JSON.parse(readFileSync(this.backlogFile, 'utf-8')) as PRD;
    } catch {
      return null;
    }
  }

  getRemainingTasks(): number {
    return remainingTasks(this.loadPRDImpl(), this.config);
  }

  getWorkableCount(): number {
    return workableCount(this.loadPRDImpl(), this.config);
  }

  getNextTaskName(): string | null {
    return nextTaskName(this.loadPRDImpl(), this.config);
  }

  private verify(): string | null {
    return verifyMerged(this.gitRunner, this.config.base_branch);
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
    const state = this.store.load();
    if (state.status === 'halted') {
      state.status = 'ready';
      state.stall_count = 0;
      this.store.save(state);
    }
  }

  resetState(): void {
    this.store.reset();
    this.logger.log('INFO', 'State reset complete');
  }

  async runIteration(iteration: number): Promise<boolean> {
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
    const tier = tierFor(this.loadPRDImpl(), this.config, attemptedTask);
    this.logger.log('INFO', `Running Claude (session: ${sessionId.slice(0, 8)}...)`);
    if (attemptedTask) {
      this.logger.log('INFO', `Ticket: ${attemptedTask} [${tier.model}, $${tier.budget}]`);
    }

    const startTime = Date.now();
    const result = await this.spawnClaude({
      prompt,
      sessionId,
      outputFile,
      tier,
      cwd: this.projectRoot,
      timeoutMinutes: this.config.limits.timeoutMinutes,
    });
    const duration = Math.round((Date.now() - startTime) / 1000);
    this.logger.log('INFO', `Claude finished in ${duration}s (exit: ${result.exitCode})`);

    if (result.timedOut) {
      this.logger.log('ERROR', `Iteration ${iteration} timed out`);
      state.status = 'timeout';
      state.failed_iterations++;
      state.consecutive_failures++;
      state.last_error = `Timeout after ${this.config.limits.timeoutMinutes} minutes`;
      this.store.save(state);
      return false;
    }

    if (result.output.includes('<process>stop</process>')) {
      this.logger.log('WARN', `Iteration ${iteration} signaled STOP`);
      const match = result.output.match(
        /<process>stop<\/process>[\s\S]*?(?:blocked|reason|because)[:\s]*([^\n]+)/i
      );
      this.halt(match ? match[1].trim() : 'Agent signaled stop - blocked or no actionable work');
      return false;
    }

    if (result.output.includes('<process>complete</process>')) {
      // The signal is the agent's account of itself; check it against the repo.
      const unmerged = this.verify();
      if (unmerged) {
        this.logger.log('ERROR', `Iteration ${iteration} claimed complete but ${unmerged}`);
        state.status = 'failed';
        state.failed_iterations++;
        state.consecutive_failures++;
        state.last_error = `Claimed complete but ${unmerged}`;
        this.store.save(state);
        return false;
      }

      this.logger.log('SUCCESS', `Iteration ${iteration} completed`);
      state.status = 'completed';
      state.last_completed_at = new Date().toISOString();
      state.completed_iterations++;
      state.consecutive_failures = 0;
      state.current_task = null;

      // Record the attempted ticket only if the backlog agrees it is done. An
      // agent may legitimately work something else (recovering a prior
      // iteration's unfinished merge), and recording the wrong name would feed
      // the next prompt a false history.
      if (
        attemptedTask &&
        isTicketCompleted(this.loadPRDImpl(), attemptedTask) &&
        !state.completed_tasks.includes(attemptedTask)
      ) {
        state.completed_tasks.push(attemptedTask);
      }

      this.store.save(state);
      return true;
    }

    const progressIndicators = ['commit', 'merged', 'completed', 'PR created'];
    const hasProgress = progressIndicators.some(ind =>
      result.output.toLowerCase().includes(ind.toLowerCase())
    );
    if (hasProgress) {
      this.logger.log('INFO', 'Partial progress detected');
      state.status = 'partial';
      state.consecutive_failures = 0;
      this.store.save(state);
      return true;
    }

    this.logger.log('WARN', `Iteration ${iteration} did not complete cleanly`);
    state.status = 'failed';
    state.failed_iterations++;
    state.consecutive_failures++;
    state.last_error = `No completion signal, exit code: ${result.exitCode}`;
    this.store.save(state);
    this.haltOnDivergence(attemptedTask);
    return false;
  }

  /**
   * A failed iteration can still have written `completed` into the backlog
   * before it died - the agent finishes the work, commits to its branch,
   * updates the ticket, then hits the budget cap. The backlog then claims work
   * that is not on the base branch, and ticket selection would march past it
   * onto an unmerged dependency. Stop and let a human recover the intact branch
   * rather than reverting the ticket and discarding the record of the work.
   */
  private haltOnDivergence(attemptedTask: string | null): void {
    if (!attemptedTask) return;
    if (!isTicketCompleted(this.loadPRDImpl(), attemptedTask)) return;
    const unmerged = this.verify();
    if (!unmerged) return;
    this.halt(
      `"${attemptedTask}" reads completed in the backlog but ${unmerged}. ` +
        `The work is most likely finished on its branch and was cut off before ` +
        `it could be pushed or merged - recover it rather than re-running the ticket.`
    );
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

    let iteration = initial.iteration;
    const sessionStartIteration = iteration;
    this.logger.log(
      'INFO',
      `Starting automation (${continuous ? 'continuous' : `${iterations} iterations`})`
    );

    let completed = 0;
    const {maxStallIterations, maxConsecutiveFailures, pauseAfterFailure, pauseBetweenIterations} =
      this.config.limits;

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
      const stall = stallUpdate(
        currentState.last_remaining_count,
        currentState.stall_count,
        remaining,
        maxStallIterations
      );
      currentState.stall_count = stall.stall_count;
      if (stall.stalled) {
        const reason = `Stalled: ${remaining} tasks remain but no progress for ${maxStallIterations} iterations`;
        this.store.save(currentState);
        this.halt(reason);
        this.logger.log('ERROR', reason);
        break;
      }
      if (
        currentState.last_remaining_count !== null &&
        remaining === currentState.last_remaining_count
      ) {
        this.logger.log(
          'WARN',
          `No progress: ${remaining} tasks (stall ${stall.stall_count}/${maxStallIterations})`
        );
      }
      currentState.last_remaining_count = remaining;
      this.store.save(currentState);

      if (remaining === 0) {
        this.logger.log('SUCCESS', 'All tasks completed!');
        break;
      }

      if (currentState.consecutive_failures >= maxConsecutiveFailures) {
        this.halt(`Too many consecutive failures (${maxConsecutiveFailures})`);
        break;
      }

      this.logger.log('INFO', `Remaining tasks: ${remaining}`);

      if (await this.runIteration(iteration)) {
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
