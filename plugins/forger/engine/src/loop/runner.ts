/**
 * The outer loop: the single-runner lock, the halt, stall and failure limits
 * that decide whether another iteration starts, and the status and watch
 * displays. One iteration itself lives in `iteration.ts`. The agent spawn and
 * the git runner are handed in, so the loop can be driven in a test without a
 * real agent or repo.
 */

import {existsSync, mkdirSync, readdirSync, readFileSync} from 'fs';
import {join} from 'path';

import {forgerPath, resolveModel, type WorkloopConfig} from '../config';
import {describeBlocked, pick, schedule, startDecision, type Backlog, type FolderMap, type Schedulable} from '../backlog';
import {capturing, type AgentRunner, type CapturingRunner, type CommandRunner, type ProbeRunner, type StateStore} from '../ports';
import {type AutomationState, currentTicket, LoopStore} from './state';
import type {TrackerHalt} from './halt-tracker';
import {Logger, colors} from './logger';
import {runDelivery} from './delivery';
import {fileAccessReview} from './reviews/access-review-io';
import {ACCESS_REVIEW} from './reviews/access-review';
import {readReviewTemplate} from './reviews/schedule';
import {STRUCTURE_REVIEW} from './reviews/structure-review';
import {fileStructureReview} from './reviews/structure-review-io';
import {RateLimitError, rateLimitWaitMs} from './infra';
import type {StoredPlan} from '../pipeline';
import {type IterationContext, type Placement, closeOrphan, runIteration} from './iteration';
import {conflictAfterAttempt, folderMapFrom, inWorktree} from './parallel';
import {worktreeWorkspace, type WorkspaceSandbox} from './worktree-workspace';
import {pidAlive, RunnerLock} from './lock';
import {criterionOptions, refuseUncheckable} from './ticket-check';
import {eventLine, parseAllEvents, terminalEvent, type EventKind, type TerminalEvent, type TerminalEventKind} from './events';
import {UNCAUSED, type HaltClearWhy} from './halt-clear';
import {appendSchedule} from './schedule-log';
import {buildStatus, type StatusReport} from './status-report';

/** Who the engine is when it holds the cross-machine lease (ADR 0015). */
export interface LeaseSettings {
  self: string;
  host: string;
  ttlSeconds: number;
}

/** The lease lasts longer than the renewal timer and shorter than the run timeout. */
export const DEFAULT_LEASE_TTL_SECONDS = 15 * 60;

export interface RunnerDeps {
  /** Set when the state lives on the state branch: the runner then holds the lease while it runs. */
  lease?: LeaseSettings;
  /** The agent spawn; a runner built without one can report and watch, but refuses to run an iteration. */
  agent?: AgentRunner;
  /** Prepares and cleans up each worker's workspace; the git worktree when absent. */
  sandbox?: WorkspaceSandbox;
  gitRunner: CommandRunner;
  /** Runs a ticket's probes on the host; without one a ticket's probes are not run. */
  probeRunner?: ProbeRunner;
  /** Where state and events are kept. */
  stateStore: StateStore;
  /** The git runner that reports failures, for worktrees; defaults to the plain runner seen as one that never fails. */
  gitCapture?: CapturingRunner;
  /** The folder map the scheduling rule reads; defaults to the architecture map of the project. */
  folderMap?: FolderMap;
  uuid?: () => string;
  /** Liveness probe for the lock holder; defaults to a signal-0 check. */
  isAlive?: (pid: number) => boolean;
  pid?: number;
  /** Registers a handler for a stop signal; defaults to `process.on`. */
  onSignal?: (signal: 'SIGTERM' | 'SIGINT', handler: () => void) => void;
  /** Ends the process after a signal released the lease; defaults to `process.exit`. */
  exit?: (code: number) => void;
  /** Clock and wait, injectable so a rate-limit wait runs in a test without waiting. */
  now?: () => number;
  /** The `halted` label on the pinned loop issue; omitted when the tracker is not GitHub. */
  haltTracker?: TrackerHalt;
  sleep?: (ms: number) => Promise<void>;
  /** The pipeline plan for a ticket, stored with the run; a failure to resolve leaves the run without one. */
  resolvePlan?: (ticket: string | null) => StoredPlan | null;
  /** The plugin the engine runs from; workers get it as `FORGER_PLUGIN_ROOT`, which the committed gates name. */
  pluginRoot?: string;
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
  private store: LoopStore;
  private stateStore: StateStore;
  private outputDir: string;
  private gitRunner: CommandRunner;
  private agent: AgentRunner;
  private sandbox: WorkspaceSandbox;
  private uuid: () => string;
  private lock: RunnerLock;
  private isAliveFn: (pid: number) => boolean;
  private scheduleFile: string;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private iteration: IterationContext;
  private gitCapture: CapturingRunner;
  private folderMap: FolderMap | undefined;
  private leaseSettings: LeaseSettings | undefined;
  private leaseLost = false;
  private leaseTimer: ReturnType<typeof setInterval> | undefined;
  private released = false;
  private onSignal: (signal: 'SIGTERM' | 'SIGINT', handler: () => void) => void;
  private exit: (code: number) => void;

  constructor(
    private projectRoot: string,
    private config: WorkloopConfig,
    private backlog: Backlog,
    deps: RunnerDeps
  ) {
    const p = (rel: string): string => join(projectRoot, rel);
    this.logger = new Logger(p(config.paths.log));
    this.stateStore = deps.stateStore;
    this.store = new LoopStore(this.stateStore, p(config.paths.halt), deps.haltTracker ?? null);
    this.outputDir = p(config.paths.output);
    this.scheduleFile = join(p(config.paths.output), 'schedule-decisions.jsonl');
    this.isAliveFn = deps.isAlive ?? pidAlive;
    this.lock = new RunnerLock(p(config.paths.lock), deps.pid, this.isAliveFn);

    this.gitRunner = deps.gitRunner;
    this.gitCapture = deps.gitCapture ?? capturing(deps.gitRunner);
    this.folderMap = deps.folderMap;
    this.leaseSettings = deps.lease;
    this.onSignal = deps.onSignal ?? ((signal, handler) => void process.on(signal, handler));
    this.exit = deps.exit ?? (code => process.exit(code));
    this.sandbox = deps.sandbox ?? worktreeWorkspace(this.gitCapture);
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
      afterMerge: (iteration, ticket) => {
        this.fileReviews(iteration);
        this.deliver(iteration, ticket);
      },
      events: () => parseAllEvents(this.stateStore.readEvents()),
      resolvePlan: deps.resolvePlan,
      probeRunner: deps.probeRunner,
      pluginRoot: deps.pluginRoot,
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

  /** Takes workable tickets whose criteria cannot be checked out of the queue before a pick. GitHub only: a local ticket has no text. */
  async refuseUncheckable(): Promise<void> {
    if (this.config.tracker.kind !== 'github') return;
    const tickets = this.backlog.candidates().map(c => ({id: c.id, body: this.backlog.body(c.id)}));
    const target = {trackerKind: this.config.tracker.kind, intakeLabel: this.config.tracker.label, backlogFile: join(this.projectRoot, this.config.paths.backlog)};
    const {refused, errors} = refuseUncheckable(this.gitRunner, target, tickets, criterionOptions(this.projectRoot, this.config));
    for (const r of refused) this.logger.log('WARN', `Refused ${r.ticket}: ${r.problems.join('; ')}`);
    for (const e of errors) this.logger.log('ERROR', `Could not refuse ${e}`);
    if (refused.length > 0) await this.refreshBacklog();
  }

  private emit(kind: EventKind, iteration: number, ticket: string | null, reason: string | null, extra: Pick<TerminalEvent, 'cause' | 'not_a_defect' | 'decision'> = {}): void {
    const now = new Date();
    this.stateStore.appendEvent(eventLine(terminalEvent(kind, iteration, ticket, reason, now, extra)), now);
  }

  /** Files each periodic review that is due. Best effort: a tracker or config failure never fails the iteration. */
  private fileReviews(iteration: number): void {
    if (this.config.tracker.kind !== 'github') return;
    const kinds = [
      {kind: STRUCTURE_REVIEW, file: fileStructureReview},
      {kind: ACCESS_REVIEW, file: fileAccessReview},
    ];
    for (const {kind, file} of kinds) {
      try {
        const template = readReviewTemplate(this.projectRoot, kind);
        if (template === null) continue;
        const reason = file(this.projectRoot, this.gitRunner, this.config.tracker.label, this.stateStore.readEvents(), template);
        if (reason !== null) this.emit(kind.filedEvent, iteration, null, reason);
      } catch (e) {
        this.logger.log('WARN', `Could not check whether a ${kind.label} is due: ${(e as Error).message}`);
      }
    }
  }

  /** Runs the delivery pack's plan for the ticket that just merged. Best effort: a delivery that cannot run never fails the iteration. */
  private deliver(iteration: number, ticket: string | null): void {
    const probe = this.iteration.probeRunner;
    if (probe === undefined) return;
    try {
      runDelivery({
        projectRoot: this.projectRoot,
        base: this.config.base_branch,
        intakeLabel: this.config.tracker.label,
        run: this.gitRunner,
        probe,
        iteration,
        ticket,
        emit: (kind, it, t, reason) => this.emit(kind, it, t, reason),
        halt: reason => this.halt(reason),
        warn: message => this.logger.log('WARN', message),
      });
    } catch (e) {
      this.logger.log('WARN', `Delivery could not run: ${(e as Error).message}`);
    }
  }

  halt(reason: string, kind: TerminalEventKind = 'halted'): void {
    this.store.writeHalt(reason);
    this.logger.log('WARN', `Created HALT file: ${reason}`);
    const state = this.store.load();
    state.status = 'halted';
    state.last_error = reason;
    this.store.save(state);
    this.store.publishStatus(state);
    this.emit(kind, state.iteration, currentTicket(state), reason);
  }

  /** Ends a halt the engine recovered by itself; the event says why, not that a person cleared it. */
  recoverHalt(detail: string): void {
    this.clearHalt('recovered', detail);
  }

  clearHalt(kind: 'halt_cleared' | 'recovered' = 'halt_cleared', detail: string | null = null, why: HaltClearWhy = UNCAUSED, decision: string | null = null): void {
    const before = this.store.load();
    const wasHalted = this.store.isHalted() || before.status === 'halted';
    if (this.store.isHalted()) {
      this.store.clearHalt();
      this.logger.log('INFO', 'Cleared HALT file');
    }
    if (wasHalted) {
      const extra = kind === 'halt_cleared' ? {cause: why.cause, not_a_defect: why.notADefect, ...(decision === null ? {} : {decision})} : {};
      this.emit(kind, before.iteration, currentTicket(before), detail ?? before.last_error, extra);
    }
    // The counters that tripped the halt would trip it again on the first
    // iteration after the human has fixed the cause.
    const state = this.store.load();
    if (state.status === 'halted') state.status = 'ready';
    state.consecutive_failures = 0;
    state.consecutive_set_asides = 0;
    state.stall_count = 0;
    this.store.save(state);
    this.store.publishStatus(state);
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

  /** Takes, renews or takes over the lease; false (and the lease marked lost) when it is not ours. */
  private claimLease(): boolean {
    const settings = this.leaseSettings;
    if (!settings) return true;
    const claim = this.stateStore.claimLease({...settings, now: new Date(this.now()), isAlive: this.isAliveFn});
    if (claim.ok) {
      if (claim.action === 'takeover') {
        const reason = `took over the lease from ${claim.previousHolder} on ${claim.previousHost}`;
        this.logger.log('WARN', reason);
        this.emit('lease_takeover', this.store.load().iteration, null, reason);
      }
      return true;
    }
    this.leaseLost = true;
    this.logger.log(
      'ERROR',
      claim.reason === 'held'
        ? `The loop lease is held by ${claim.holder} until ${claim.expiresAt}. Not running.`
        : 'Lost the loop lease: the state branch could not be written. Stopping rather than running unguarded.'
    );
    return false;
  }

  /** Renews the lease at the top of an iteration; false when the loop must stop. */
  private leaseHeld(): boolean {
    return !this.leaseLost && this.claimLease();
  }

  /**
   * Runs the loop. Returns false without doing anything when a live runner
   * already holds the lock, or another engine holds the lease.
   */
  async run(iterations = 1, continuous = false): Promise<boolean> {
    if (!this.claimLease()) return false;
    const lock = this.lock.acquire();
    if (!lock.ok) {
      const msg = `Another runner (pid ${lock.holder}) is already running. Not starting a second one.`;
      this.logger.log('ERROR', msg);
      this.stateStore.releaseLease(this.leaseSettings?.self ?? '');
      return false;
    }
    if (lock.tookOver) {
      this.logger.log('WARN', `Took over a stale lock from dead runner (pid ${lock.tookOver})`);
    }
    if (this.leaseSettings) {
      // A long iteration outlives the TTL, so the lease is renewed on a timer as well.
      const every = Math.max(1000, (this.leaseSettings.ttlSeconds * 1000) / 3);
      this.leaseTimer = setInterval(() => {
        if (!this.leaseLost) this.claimLease();
      }, every);
    }
    this.released = false;
    // A stopped service must not leave the lease to expire: the next start would be refused.
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      this.onSignal(signal, () => {
        this.logger.log('WARN', `Stopped by ${signal}; releasing the lease and the lock`);
        this.releaseHeld();
        this.exit(signal === 'SIGTERM' ? 143 : 130);
      });
    }
    try {
      await this.refreshBacklog();
      this.closeOrphan();
      if (this.config.parallelism > 1) await this.loopParallel(iterations, continuous);
      else await this.loop(iterations, continuous);
      return true;
    } finally {
      this.releaseHeld();
    }
  }

  /** Frees the lease and the lock once, whether the run ended or a signal stopped it. */
  private releaseHeld(): void {
    if (this.released) return;
    this.released = true;
    clearInterval(this.leaseTimer);
    if (this.leaseSettings && !this.leaseLost) this.stateStore.releaseLease(this.leaseSettings.self);
    this.lock.release();
  }

  /** The owner removed the halted label: the persisted halt is over, with the counters that caused it. */
  private resumeIfLabelCleared(): void {
    if (this.store.hasTracker() && !this.store.isHalted() && this.store.load().status === 'halted') this.clearHalt();
  }

  /** A new run starts with no ticket set aside; the tickets labelled needs-human stay out of the queue on their own. */
  private startRunAside(state: AutomationState): void {
    state.set_aside_tasks = [];
    this.backlog.avoid([]);
  }

  private async loop(iterations: number, continuous: boolean): Promise<void> {
    this.resumeIfLabelCleared();
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
    this.startRunAside(initial);
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

      if (!this.leaseHeld()) break;
      if (this.store.isHalted()) {
        this.logger.log('WARN', 'HALT file detected. Stopping.');
        break;
      }

      const iterationsThisSession = iteration - sessionStartIteration;
      if (!continuous && iterationsThisSession > iterations) {
        this.logger.log('INFO', `Completed ${iterations} iterations (limit reached)`);
        break;
      }

      await this.refuseUncheckable();
      const remaining = this.getRemainingTasks();

      const currentState = this.store.load();

      const decision = startDecision(this.backlog.report());
      if (decision === 'completed') {
        this.logger.log('SUCCESS', 'All tasks completed!');
        this.emit('completed', currentState.iteration, null, null);
        break;
      }
      if (decision === 'blocked_on_owner') {
        this.endBlockedOnOwner(currentState.iteration);
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

  /** Nothing is workable: end the run without a worker and without a HALT. */
  private endBlockedOnOwner(iteration: number): void {
    const reason = describeBlocked(this.backlog.blocked());
    this.logger.log('WARN', `Nothing workable; waiting on the owner: ${reason}`);
    this.emit('blocked_on_owner', iteration, null, reason);
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
    const made = this.sandbox.prepare(o);
    if (!made.ok) return `worktree for ${ticket}: ${made.error}`;
    const cwd = made.path;
    return {
      ticket,
      cwd,
      gitRunner: inWorktree(this.gitRunner, cwd),
      abort,
      conflicts: () => conflictAfterAttempt(this.gitCapture, o),
      finish: conflicted => {
        const failed = this.sandbox.cleanup(o, conflicted);
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
    this.resumeIfLabelCleared();
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
    this.startRunAside(initial);
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
        // The engine's own failure, not the ticket's: no count, one named halt.
        const reason = `Infrastructure error (worktree): ${placed}`;
        this.logger.log('ERROR', reason);
        this.halt(reason);
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
      if (!this.leaseHeld()) {
        if (running.size === 0) break;
        abort.abort();
      } else if (this.store.isHalted()) {
        if (running.size === 0) {
          this.logger.log('WARN', 'HALT file detected. Stopping.');
          break;
        }
        if (killTimer === undefined) {
          this.logger.log('WARN', `HALT file detected; ending ${running.size} running worker(s) after ${killGraceSeconds}s`);
          killTimer = setTimeout(() => abort.abort(), killGraceSeconds * 1000);
        }
      } else {
        await this.refuseUncheckable();
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
          for (const c of chosen.slice(0, continuous ? chosen.length : iterations - started)) {
            if (this.store.isHalted()) break;
            start(c);
          }
          if (this.store.isHalted()) continue;
        }
        if (running.size === 0 && startDecision(this.backlog.report()) === 'blocked_on_owner') {
          this.endBlockedOnOwner(state.iteration);
          break;
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
      spendLimit: this.agent.spendLimit?.(this.modelsInPlay()) ?? 'none',
    });
  }

  private modelsInPlay(): string[] {
    const tiers = [...Object.values(this.config.model_by_priority), ...(this.config.verifier ? [this.config.verifier] : [])];
    return [...new Set(tiers.map(t => resolveModel(t.model, this.config.models)))];
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
