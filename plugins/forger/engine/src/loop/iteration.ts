/**
 * One iteration, start to settle: spawn the worker on the engine's pick, read
 * the git facts it left, decide the outcome and apply it to the state, the log
 * and the event file. The close-out of an iteration a dead runner left open
 * settles the same way. The outer loop that decides whether to start another
 * iteration lives in `runner.ts`.
 */

import {join} from 'path';
import {writeFileSync} from 'fs';

import type {Backlog, Footprint} from '../backlog';
import {resolveModel, type WorkloopConfig} from '../config';
import type {AgentRunner, CommandRunner, ProbeRunner} from '../ports';
import {parseClaim, type Claim} from './claim';
import {conflictComment, conflictReask, parseConflict, type Conflict} from './conflict';
import {avoidedFootprints, setAsideComment, setAsideOnTracker, setAsideUpdate, type SetAsideEntry} from './aside';
import type {EventKind, TerminalEventKind} from './events';
import {declineUpdate, type DeclineEntry} from './decline';
import {clearDeclineRecord, readDeclineRecord} from './decline-io';
import type {AutomationState} from './state';
import {classifyExit} from './infra';
import type {StoredPlan} from '../pipeline';
import {formatIterationLog} from './iteration-log';
import type {Logger} from './logger';
import {verifyMerged} from './merged';
import {issueOfTicket, mergeMode, ownerReviewLabelCommands, settleOwnerMerges} from './owner-review';
import {decideOutcome, type Outcome} from './outcome';
import type {PrFact} from './pr-checks';
import type {Decision} from './verdict';
import {readVerdicts, recordedDecision} from './verdict-store';
import {actualOf, failedProbe, parseProbes, probeFailureComment, probePromptSection, runProbes, type ProbeRun} from './probe';
import {probeHandBack} from './probe-io';
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
  /** Runs after a merged ticket is recorded; the structure review trigger. */
  afterMerge?(iteration: number, ticket: string | null): void;
  /** The pipeline plan for a ticket; absent or null leaves the run without one. */
  resolvePlan?(ticket: string | null): StoredPlan | null;
  /** Runs a probe command on the host; absent, probes are not run. */
  probeRunner?: ProbeRunner;
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

function lastCommits(git: CommandRunner, branch: string): string[] {
  const out = git(`git log -3 --format="%h %s" ${branch}`);
  return out === '' ? [] : out.split('\n');
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
  recordOwnerMerges(ctx, state);
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

  // Read before the run: a worker that hands the ticket over takes it out of the queue, and its text with it.
  const ownBody = attemptedTask ? ctx.backlog.body(attemptedTask) : null;
  const {timeoutMinutes, killGraceSeconds} = ctx.config.limits;
  const probes = attemptedTask && ctx.probeRunner ? runProbes(parseProbes(ctx.backlog.body(attemptedTask)), c => ctx.probeRunner!(c, root, timeoutMinutes * 60 * 1000)) : [];
  const failed = failedProbe(probes);
  if (failed) {
    // Not a worker's failure: no count, no stall, no halt; the ticket leaves the queue and the next pick is another.
    handBackProbe(ctx, iteration, attemptedTask, failed);
    const after = ctx.store.load();
    endRun(after, sessionId);
    after.status = ctx.store.isHalted() ? 'halted' : after.in_flight.length > 0 ? 'running' : 'ready';
    ctx.store.save(after);
    await ctx.refreshBacklog();
    placement?.finish(false);
    return false;
  }
  const deadline = new Date(Date.now() + timeoutMinutes * 60 * 1000);
  const prompt = buildPrompt(ctx.config, iteration, state.completed_tasks, attemptedTask, placement !== undefined, deadline, probePromptSection(probes));
  const tier = ctx.backlog.tier(attemptedTask);
  ctx.logger.log('INFO', `Running the agent (session: ${sessionId.slice(0, 8)}...)`);
  if (attemptedTask) {
    ctx.logger.log('INFO', `Ticket: ${attemptedTask} [${tier.model}, $${tier.budget}] session ${sessionId}`);
  }

  const model = resolveModel(tier.model, ctx.config.models);
  if (ctx.agent.spendLimit?.([model]) === 'none') {
    ctx.logger.log('WARN', `The ${ctx.agent.harnessId ?? 'harness'} harness reports no usage for ${model}: this run has no spend limit, only the ${timeoutMinutes} minute timeout`);
  }
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
    model,
    workerCommand: ctx.config.worker_command,
    cwd: root,
    env: workerEnv(attemptedTask, iteration, ctx.pluginRoot, deadline, placement?.cwd),
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
    ...(result.timedOut
      ? {progress: {branch: gitFacts.branch, commits: gitFacts.branch ? lastCommits(git, gitFacts.branch) : [], pr: gitFacts.pr ? {number: gitFacts.pr.number, state: gitFacts.pr.state} : null}}
      : {}),
  };
  writeFileSync(outputFile, formatIterationLog(logFacts));
  if (result.overSpend) ctx.logger.log('WARN', `Spend limit $${result.overSpend.limitUsd} passed (reported $${result.overSpend.spentUsd}); worker stopped`);
  ctx.logger.log('INFO', `Claude finished in ${duration}s (exit: ${result.exitCode})`);

  const claim = parseClaim(result.output);
  const conflictStop = claim.conflictBlock === undefined ? null : await completeConflict(ctx, claim, {prompt, sessionId, tier, model, root, timeoutMinutes, killGraceSeconds, deadline, attemptedTask, iteration});
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
    ownerReviews: ticket !== null && mergeMode(ctx.backlog.body(ticket)) === 'owner reviews',
    conflictStop,
  });

  // Rewritten with the decided status so measures can read it back from the file.
  writeFileSync(outputFile, formatIterationLog({...logFacts, status: outcome.status}));

  const declined: DeclineEntry | null =
    outcome.status === 'declined' && record ? {ticket: record.ticket, reason: record.reason, iteration} : null;
  const body = ticket === attemptedTask ? ownBody : ticket === null ? null : ctx.backlog.body(ticket);
  const settled = settle(ctx, sessionId, iteration, ticket, backlogCompleted, outcome, countStall, declined, ticket === null ? null : ctx.backlog.footprint(ticket, body));
  placement?.finish(outcome.status === 'conflict');
  return settled;
}

/**
 * Tickets left for the owner whose PR the owner has since merged read
 * completed in the tracker; they count as completed now.
 */
function recordOwnerMerges(ctx: IterationContext, state: AutomationState): void {
  if (state.owner_review_tasks.length === 0) return;
  const settled = settleOwnerMerges(state.owner_review_tasks, state.completed_tasks, t => ctx.backlog.isCompleted(t));
  if (settled.completed.length === 0) return;
  state.owner_review_tasks = settled.pending;
  state.completed_tasks = settled.completed_tasks;
  state.completed_iterations += settled.completed.length;
  state.last_completed_at = new Date().toISOString();
  for (const t of settled.completed) ctx.logger.log('SUCCESS', `The owner merged ${t}`);
  ctx.store.save(state);
}

/** Labels the issue, comments the failed probe and records the event; a tracker failure halts, since the ticket would be picked again. */
function handBackProbe(ctx: IterationContext, iteration: number, ticket: string | null, failed: ProbeRun): void {
  const issue = issueOfTicket(ticket);
  ctx.logger.log('WARN', `Probe \`${failed.probe.command}\` failed for ${ticket}: ${actualOf(failed.result)}`);
  ctx.emit('probe_failed', iteration, ticket, `\`${failed.probe.command}\` expected ${failed.probe.expected}; got ${actualOf(failed.result)}`);
  if (issue === null || ctx.config.tracker.kind !== 'github') return;
  try {
    probeHandBack(ctx.gitRunner, issue, probeFailureComment(failed), ctx.config.tracker.label);
  } catch (e) {
    ctx.halt(`Infrastructure error (probe): could not hand ${ticket} back: ${e instanceof Error ? e.message : String(e)}`);
  }
}

interface ReaskContext {
  prompt: string;
  sessionId: string;
  tier: ReturnType<IterationContext['backlog']['tier']>;
  model: string;
  root: string;
  timeoutMinutes: number;
  killGraceSeconds: number;
  deadline: Date;
  attemptedTask: string | null;
  iteration: number;
}

/**
 * The conflict a stop carries, complete: a block with a gap is rejected and the
 * worker is asked once more; a second incomplete block is an ordinary stop.
 */
async function completeConflict(ctx: IterationContext, claim: Claim, r: ReaskContext): Promise<Conflict | null> {
  const first = parseConflict(claim.conflictBlock ?? '');
  if (first.ok) return first.conflict;
  ctx.logger.log('WARN', `Conflict stop rejected: ${first.problems.join('; ')}; asking once more`);
  const again = await ctx.agent.run({
    prompt: `${r.prompt}\n\n${conflictReask(first.problems)}`,
    sessionId: r.sessionId,
    tier: r.tier,
    model: r.model,
    workerCommand: ctx.config.worker_command,
    cwd: r.root,
    env: workerEnv(r.attemptedTask, r.iteration, ctx.pluginRoot, r.deadline, r.root === ctx.projectRoot ? undefined : r.root),
    timeoutMinutes: r.timeoutMinutes,
    killGraceSeconds: r.killGraceSeconds,
    readOnly: true,
  });
  const second = parseClaim(again.output);
  const parsed = second.conflictBlock === undefined ? null : parseConflict(second.conflictBlock);
  if (parsed?.ok) return parsed.conflict;
  ctx.logger.log('WARN', `Conflict stop rejected again: ${parsed ? parsed.problems.join('; ') : 'no conflict block'}; recorded as an ordinary stop`);
  return null;
}

/** Labels the issue needs-human and posts the reason or the options; a tracker failure is logged, the ticket is set aside either way. */
function handToOwnerOnStop(ctx: IterationContext, ticket: string | null, reason: string, conflict: Conflict | undefined): void {
  const issue = issueOfTicket(ticket);
  if (issue === null || ctx.config.tracker.kind !== 'github') return;
  const comment = conflict ? conflictComment(issue, conflict) : setAsideComment(issue, reason);
  for (const problem of setAsideOnTracker(ctx.gitRunner, issue, comment, conflict !== undefined)) ctx.logger.log('WARN', problem);
}

/** Marks the PR and its issue, records the event and remembers the ticket; label failures are logged, not fatal. */
function handToOwner(ctx: IterationContext, iteration: number, ticket: string | null, pr: number): void {
  for (const command of ownerReviewLabelCommands(pr, issueOfTicket(ticket))) {
    try {
      ctx.gitRunner(command);
    } catch (e) {
      ctx.logger.log('WARN', `Could not run \`${command}\`: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  ctx.emit('owner_review', iteration, ticket, `PR #${pr}`);
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
  declined: DeclineEntry | null = null,
  footprint: Footprint | null = null
): boolean {
  const {maxStallIterations, maxConsecutiveDeclines, maxSetAside} = ctx.config.limits;
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
    if (outcome.merged && outcome.result === 'success') ctx.emit('merged', iteration, ticket, null);
  } else if (outcome.result === 'failure') {
    ctx.logger.log('ERROR', `Iteration ${iteration}: ${outcome.error}`);
    state.failed_iterations++;
    state.consecutive_failures++;
    state.last_error = outcome.error;
  } else if (outcome.status === 'owner-review') {
    if (ticket && !state.owner_review_tasks.includes(ticket)) state.owner_review_tasks.push(ticket);
  } else if (outcome.setAside === undefined) {
    ctx.logger.log('WARN', `Iteration ${iteration} signaled STOP`);
  }
  if (outcome.warning) ctx.logger.log('WARN', `Iteration ${iteration}: ${outcome.warning}`);

  // The first iteration after a start has no earlier run in this session to
  // have stalled behind, so it is never counted.
  const stall = countStall
    ? stallUpdate(state.stall_count, outcome.merged || outcome.status === 'owner-review', maxStallIterations)
    : {stall_count: state.stall_count, stalled: false};
  state.stall_count = stall.stall_count;
  const declines = declineUpdate(state.declined_tasks, state.consecutive_declines, declined, maxConsecutiveDeclines);
  state.declined_tasks = declines.declined_tasks;
  state.consecutive_declines = declines.consecutive_declines;
  const aside: SetAsideEntry | null = outcome.setAside === undefined ? null : {ticket: ticket ?? 'no ticket', reason: outcome.setAside, iteration, footprint};
  const asides = setAsideUpdate(state.set_aside_tasks, state.consecutive_set_asides, aside, outcome.merged, maxSetAside);
  state.set_aside_tasks = asides.set_aside_tasks;
  state.consecutive_set_asides = asides.consecutive_set_asides;
  ctx.store.save(state);
  ctx.backlog.avoid(avoidedFootprints(state.set_aside_tasks));

  if (outcome.merged && outcome.result === 'success') ctx.afterMerge?.(iteration, ticket);

  if (aside) {
    ctx.logger.log('WARN', `Iteration ${iteration} set ${aside.ticket} aside: ${aside.reason.split('\n')[0]}`);
    ctx.emit('set_aside', iteration, ticket, aside.reason);
    handToOwnerOnStop(ctx, ticket, aside.reason, outcome.conflictStop);
  }

  if (outcome.ownerReviewPr !== undefined) handToOwner(ctx, iteration, ticket, outcome.ownerReviewPr);

  if (outcome.status === 'timeout') {
    ctx.emit('timed_out', iteration, ticket, outcome.error);
  }

  if (outcome.halt) {
    ctx.halt(outcome.halt, outcome.haltKind);
  } else if (declines.halt) {
    ctx.logger.log('ERROR', declines.halt);
    ctx.halt(declines.halt);
  } else if (asides.halt) {
    ctx.logger.log('ERROR', asides.halt);
    ctx.halt(asides.halt);
  } else if (stall.stalled) {
    const reason = `Stalled: nothing merged in ${maxStallIterations} iterations`;
    ctx.logger.log('ERROR', reason);
    ctx.halt(reason, 'stalled');
  } else if (!outcome.merged && outcome.status !== 'owner-review' && countStall) {
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
