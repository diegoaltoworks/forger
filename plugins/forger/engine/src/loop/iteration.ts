/**
 * One iteration, start to settle: spawn the worker on the engine's pick, read
 * the git facts it left, decide the outcome and apply it to the state, the log
 * and the event file. The close-out of an iteration a dead runner left open
 * settles the same way. The outer loop that decides whether to start another
 * iteration lives in `runner.ts`.
 */

import {join} from 'path';
import {writeFileSync} from 'fs';

import type {Backlog} from '../backlog';
import {resolveModel, type WorkloopConfig} from '../config';
import type {AgentRunner, CommandRunner} from '../ports';
import {parseClaim} from './claim';
import type {EventKind, TerminalEventKind} from './events';
import {declineUpdate, type DeclineEntry} from './decline';
import {clearDeclineRecord, readDeclineRecord} from './decline-io';
import {classifyExit} from './infra';
import type {StoredPlan} from '../pipeline';
import {formatIterationLog} from './iteration-log';
import type {Logger} from './logger';
import {verifyMerged} from './merged';
import {decideOutcome, type Outcome} from './outcome';
import type {PrFact} from './pr-checks';
import type {Decision} from './verdict';
import {readVerdicts, recordedDecision} from './verdict-store';
import {buildPrompt} from './prompt';
import {workerEnv} from './worker-env';
import {gatherFacts, takeSnapshot, ticketFromBranch} from './run-facts';
import {type InFlightRun, endRun, type LoopStore, stallUpdate, startRun, updateRun} from './state';

/** What an iteration reads and writes, handed in by the runner that owns it. */
export interface IterationContext {
  projectRoot: string;
  config: WorkloopConfig;
  backlog: Backlog;
  store: LoopStore;
  logger: Logger;
  outputDir: string;
  gitRunner: CommandRunner;
  agent: AgentRunner;
  uuid: () => string;
  refreshBacklog(): Promise<void>;
  emit(kind: EventKind, iteration: number, ticket: string | null, reason: string | null): void;
  halt(reason: string, kind?: TerminalEventKind): void;
  /** The pipeline plan for a ticket; absent or null leaves the run without one. */
  resolvePlan?(ticket: string | null): StoredPlan | null;
  /** Exported to the worker, whose gates name it. */
  pluginRoot?: string;
}

/**
 * Where one run happens when workers share the loop (ADR 0011): its own
 * worktree, so its git facts, its decline record and its verdicts are read
 * there, and the main checkout is never the worker's tree.
 */
export interface Placement {
  ticket: string;
  cwd: string;
  /** Git calls that act on the worktree. */
  gitRunner: CommandRunner;
  /** Ends the worker's process group when aborted. */
  abort?: AbortSignal;
  /** The files still in conflict with base after the worker's attempt; null when none. */
  conflicts(): string[] | null;
  /** Takes the worktree down; a conflicted branch is dropped with it. */
  finish(conflicted: boolean): void;
}

function verify(ctx: IterationContext): string | null {
  const {state, log, output, halt, lock, events, declined, verdicts} = ctx.config.paths;
  const ignore = [state, log, output, halt, lock, events, declined, verdicts, ...ctx.config.local_only];
  return verifyMerged(ctx.gitRunner, ctx.config.base_branch, ignore);
}

export async function runIteration(
  ctx: IterationContext,
  iteration: number,
  countStall = true,
  placement?: Placement
): Promise<boolean> {
  const state = ctx.store.load();
  const git = placement?.gitRunner ?? ctx.gitRunner;
  const root = placement?.cwd ?? ctx.projectRoot;
  const outputFile = join(ctx.outputDir, `iteration-${iteration}.log`);
  const sessionId = ctx.uuid();

  ctx.logger.log('INFO', `Starting iteration ${iteration}`);

  state.iteration = iteration;
  state.status = 'running';
  startRun(state, {ticket: null, pid: null, session_id: sessionId, snapshot: null, started_at: new Date().toISOString()});
  ctx.store.save(state);

  // Capture the ticket we are ABOUT to work before the agent runs. Reading it
  // afterwards records the *next* not-started ticket instead of the one just
  // implemented, so completed_tasks would lag a ticket behind.
  const attemptedTask = placement ? placement.ticket : ctx.backlog.next();
  const plan = ctx.resolvePlan?.(attemptedTask) ?? null;
  updateRun(state, sessionId, {ticket: attemptedTask, plan});
  ctx.store.save(state);
  if (attemptedTask) ctx.emit('picked', iteration, attemptedTask, null);

  const prompt = buildPrompt(ctx.config, iteration, state.completed_tasks, attemptedTask, placement !== undefined);
  const tier = ctx.backlog.tier(attemptedTask);
  ctx.logger.log('INFO', `Running the agent (session: ${sessionId.slice(0, 8)}...)`);
  if (attemptedTask) {
    ctx.logger.log('INFO', `Ticket: ${attemptedTask} [${tier.model}, $${tier.budget}] session ${sessionId}`);
  }

  const {timeoutMinutes, killGraceSeconds} = ctx.config.limits;
  const base = ctx.config.base_branch;
  // With workers side by side another worker's merge moves base too, so only
  // the PR's own state can say this run merged.
  const snapshot = placement ? {...takeSnapshot(git, base), baseSha: ''} : takeSnapshot(git, base);
  updateRun(state, sessionId, {snapshot});
  ctx.store.save(state);
  // A record left by an earlier run must not speak for this one.
  const declinedFile = join(root, ctx.config.paths.declined);
  clearDeclineRecord(declinedFile);
  const startTime = Date.now();
  const startedAt = new Date(startTime).toISOString();
  const result = await ctx.agent.run({
    prompt,
    sessionId,
    tier,
    model: resolveModel(tier.model, ctx.config.models),
    workerCommand: ctx.config.worker_command,
    cwd: root,
    env: workerEnv(attemptedTask, iteration, ctx.pluginRoot),
    timeoutMinutes,
    killGraceSeconds,
    abort: placement?.abort,
  });
  const duration = Math.round((Date.now() - startTime) / 1000);
  // The worker changes ticket statuses while it runs; this read also serves
  // the loop's next remaining-work check.
  await ctx.refreshBacklog();

  const gitFacts = gatherFacts(git, base, snapshot);
  // A branch that names no backlog ticket (a typo fix, a recovery branch)
  // leaves the run held to the engine's pick.
  const branchTicket = ticketFromBranch(gitFacts.branch);
  const taken = branchTicket && ctx.backlog.has(branchTicket) ? branchTicket : null;
  const ticket = taken ?? attemptedTask;
  if (taken && taken !== attemptedTask) {
    ctx.logger.log('INFO', `Worker took ${taken} (engine picked ${attemptedTask ?? 'none'})`);
  }

  const logFacts = {
    iteration,
    ticket,
    enginePick: attemptedTask,
    elapsedSeconds: duration,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    timeoutMinutes,
    output: result.output,
    startedAt,
    parallelism: ctx.config.parallelism,
    plan,
  };
  writeFileSync(outputFile, formatIterationLog(logFacts));
  if (result.overSpend) ctx.logger.log('WARN', `Spend limit $${result.overSpend.limitUsd} passed (reported $${result.overSpend.spentUsd}); worker stopped`);
  ctx.logger.log('INFO', `Claude finished in ${duration}s (exit: ${result.exitCode})`);

  const claim = parseClaim(result.output);
  const backlogCompleted = ticket !== null && ctx.backlog.isCompleted(ticket);
  const record = readDeclineRecord(declinedFile);
  clearDeclineRecord(declinedFile);
  const conflict = placement && !gitFacts.merged && gitFacts.pushed ? placement.conflicts() : null;
  const exit = classifyExit(result.exitCode, result.output, result.timedOut, result.inputError ?? null);
  const outcome = decideOutcome({
    ...gitFacts,
    infraError: exit.kind === 'infrastructure' ? exit.reason : null,
    conflict,
    ticket,
    enginePick: attemptedTask,
    declined: record?.ticket ?? null,
    claim: claim.claim,
    stopReason: claim.stopReason,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    timeoutMinutes,
    baseBranch: base,
    backlogCompleted,
    unclean: gitFacts.merged && !placement ? verify(ctx) : null,
    verdict: verdictOf(ctx, gitFacts.pr, root),
  });

  // Rewritten with the decided status so measures can read it back from the file.
  writeFileSync(outputFile, formatIterationLog({...logFacts, status: outcome.status}));

  const declined: DeclineEntry | null =
    outcome.status === 'declined' && record ? {ticket: record.ticket, reason: record.reason, iteration} : null;
  const settled = settle(ctx, sessionId, iteration, ticket, backlogCompleted, outcome, countStall, declined);
  placement?.finish(outcome.status === 'conflict');
  return settled;
}

/**
 * Applies a decided outcome to the state, the log and the event file. Shared
 * by a finished run and by the close-out of an iteration a dead runner left
 * open.
 */
function settle(
  ctx: IterationContext,
  sessionId: string,
  iteration: number,
  ticket: string | null,
  backlogCompleted: boolean,
  outcome: Outcome,
  countStall: boolean,
  declined: DeclineEntry | null = null
): boolean {
  const {maxStallIterations, maxConsecutiveDeclines} = ctx.config.limits;
  // Read afresh: other runs wrote the state while this one was away.
  const state = ctx.store.load();
  endRun(state, sessionId);
  state.status = ctx.store.isHalted() ? 'halted' : state.in_flight.length > 0 ? 'running' : outcome.status;
  if (outcome.result === 'success') {
    ctx.logger.log('SUCCESS', `Iteration ${iteration} merged ${ticket ?? 'a change'}`);
    state.last_completed_at = new Date().toISOString();
    state.completed_iterations++;
    state.consecutive_failures = 0;
    state.last_error = null;
    // Merged is the fact; the backlog naming the ticket completed is what
    // makes the name safe to feed the next prompt as history.
    if (ticket && backlogCompleted && !state.completed_tasks.includes(ticket)) {
      state.completed_tasks.push(ticket);
    }
  } else if (outcome.result === 'failure') {
    ctx.logger.log('ERROR', `Iteration ${iteration}: ${outcome.error}`);
    state.failed_iterations++;
    state.consecutive_failures++;
    state.last_error = outcome.error;
  } else {
    ctx.logger.log('WARN', `Iteration ${iteration} signaled STOP`);
  }
  if (outcome.warning) ctx.logger.log('WARN', `Iteration ${iteration}: ${outcome.warning}`);

  // The first iteration after a start has no earlier run in this session to
  // have stalled behind, so it is never counted.
  const stall = countStall
    ? stallUpdate(state.stall_count, outcome.merged, maxStallIterations)
    : {stall_count: state.stall_count, stalled: false};
  state.stall_count = stall.stall_count;
  const declines = declineUpdate(state.declined_tasks, state.consecutive_declines, declined, maxConsecutiveDeclines);
  state.declined_tasks = declines.declined_tasks;
  state.consecutive_declines = declines.consecutive_declines;
  ctx.store.save(state);

  if (outcome.status === 'timeout') {
    ctx.emit('timed_out', iteration, ticket, outcome.error);
  }

  if (outcome.halt) {
    ctx.halt(outcome.halt, outcome.haltKind);
  } else if (declines.halt) {
    ctx.logger.log('ERROR', declines.halt);
    ctx.halt(declines.halt);
  } else if (stall.stalled) {
    const reason = `Stalled: nothing merged in ${maxStallIterations} iterations`;
    ctx.logger.log('ERROR', reason);
    ctx.halt(reason, 'stalled');
  } else if (!outcome.merged && countStall) {
    ctx.logger.log('WARN', `Nothing merged (stall ${stall.stall_count}/${maxStallIterations})`);
  }

  return outcome.result === 'success';
}

/**
 * An iteration still marked running when no live runner holds the lock was
 * left open by a runner that died. Its outcome is decided from git, as a
 * finished run's is, instead of re-running its ticket blindly.
 */
export function closeOrphan(ctx: IterationContext): void {
  const state = ctx.store.load();
  if (state.status !== 'running') return;
  const iteration = state.iteration;
  // Every run the dead runner had in flight is closed out, not just the first.
  const runs: Array<InFlightRun | undefined> = state.in_flight.length > 0 ? [...state.in_flight] : [undefined];
  for (const run of runs) closeRun(ctx, iteration, run);
}

function closeRun(ctx: IterationContext, iteration: number, run: InFlightRun | undefined): void {
  const ticket = run?.ticket ?? null;
  const base = ctx.config.base_branch;
  ctx.logger.log('WARN', `Iteration ${iteration} was left open by a dead runner; closing it out`);

  // Without a snapshot nothing is known about the run's start, so only the
  // current branch and its PR can speak.
  const snapshot = run?.snapshot ?? {baseSha: '', reflogLength: Number.MAX_SAFE_INTEGER};
  const gitFacts = gatherFacts(ctx.gitRunner, base, snapshot);
  const taken = ticketFromBranch(gitFacts.branch);
  const held = taken && ctx.backlog.has(taken) ? taken : ticket;
  const backlogCompleted = held !== null && ctx.backlog.isCompleted(held);
  const outcome = decideOutcome({
    ...gitFacts,
    infraError: null,
    conflict: null,
    ticket: held,
    enginePick: ticket,
    declined: null,
    claim: null,
    stopReason: null,
    exitCode: -1,
    signal: null,
    timedOut: false,
    timeoutMinutes: ctx.config.limits.timeoutMinutes,
    baseBranch: base,
    backlogCompleted,
    unclean: gitFacts.merged ? verify(ctx) : null,
    verdict: verdictOf(ctx, gitFacts.pr),
  });
  ctx.emit('runner_gone', iteration, held, outcome.error ?? outcome.warning);
  settle(ctx, run?.session_id ?? '', iteration, held, backlogCompleted, outcome, false);
}

/**
 * The decision recorded for the head of the run's PR; null when there is no PR
 * or no verdict for its head. `verify` keeps records in the main checkout; a
 * worktree's own directory is read too, for a run that wrote one there.
 */
function verdictOf(ctx: IterationContext, pr: PrFact | null, root = ctx.projectRoot): Decision | null {
  if (!pr) return null;
  const dirs = [...new Set([ctx.projectRoot, root])].map(r => join(r, ctx.config.paths.verdicts));
  return recordedDecision(dirs.flatMap(d => readVerdicts(d, pr.number)), pr.head, pr.verify_passed === true);
}
