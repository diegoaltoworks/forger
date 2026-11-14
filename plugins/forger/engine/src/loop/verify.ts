/**
 * `verify --pr N`: run the fresh-context verifier on a PR's head and write the
 * record `merge` will read (ADR 0010). The input is built by `verify-input.ts`;
 * everything that touches the world (gh, git, the checkout, the agent, files)
 * sits here behind the injected runner and agent.
 */

import {existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from 'fs';
import {join} from 'path';

import type {Tier} from '../config';
import type {AgentRunner, CapturingRunner, CommandRunner, SpecReport} from '../ports';
import {BASELINE_MANIFEST, parseBaselines, withoutBaseline, type BaselineManifest} from '../ui';
import {issueNumber} from './decline';
import {ciConfigured, failingChecks, PR_FIELDS, parsePr} from './pr-checks';
import {alreadyRerun, markRerun, rerunFailedJobs, rerunMarker, failedTests, type FlakyGate} from './flaky-gate';
import {decideGatesGreen, fromGatesCommand, type GatesGreen, isGatesGreen, stillPending} from './gates-green';
import {mergeEntries, partitionCriteria} from './mechanical';
import {evidenceHolds, failedCitations, noteCutOutput, SCREENSHOTS_DIR, type CommandRun, type CopyRecord} from './evidence-check';
import {parseCommandLog} from './run-logged';
import {EVIDENCE_DEMOTION, parseCriteria, parseUiStates, reduceVerdict, type CheckedEntry, type Criterion} from './verdict';
import {buildVerifierInput, recordVerdict, type VerdictRecord} from './verify-input';
import {freeBytes, isOutOfSpace, makeScratch, outOfSpaceMessage, removeScratch} from './scratch';
import {resolveSubject} from './verify-subject';
import {setVerifyStatus, withoutVerifyStatus, type VerifyStatusOutcome} from './verify-status';

export interface VerifyOptions {
  pr: number;
  trackerKind: 'github' | 'local' | 'none';
  backlogFile: string;
  /** Directory holding the verdict records. */
  verdictsDir: string;
  /** Where the disposable checkout is made: under the state directory, never the system temp folder. */
  tmpDir: string;
  tier: Tier;
  /** `verify.setup` as configured: a shell command, "" for no setup, null to use the gates' install step, else the lockfile's. */
  setup: string | null;
  model: string;
  /** The command the harness is asked to run; it carries the verifier's prompt. */
  verifierCommand: string;
  timeoutMinutes: number;
  killGraceSeconds: number;
  sessionId: string;
  /** The spec report of the head checkout; null or absent when there is no spec to bind criteria to. */
  specReport?: (checkoutDir: string) => SpecReport | null;
  /** Sets the `forger/verify` status on the head; on a GitHub tracker the verdict is published only when given. */
  capture?: CapturingRunner;
  /** The command prefix that records a command in the copy's log (`run-logged --file <log>` is appended); absent when no log is kept. */
  runLogged?: string;
  /** The configured gates command; run in the copy to decide "Gates green" on a repository without CI. */
  gates?: string;
  /** How long "Gates green" waits for unfinished checks before it is cannot_tell; 0 or absent does not wait. */
  checksTimeoutMs?: number;
  /** Told when no setup ran in the copy, so the cause and the fix reach the operator. */
  warn?: (message: string) => void;
  /** Told when a gate failed and then passed on a rerun with no change; records and tickets it. */
  onFlaky?: (flaky: FlakyGate) => void;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

/** The record as written, plus what publishing it as a commit status did. */
export type VerifyResult = VerdictRecord & {status?: VerifyStatusOutcome};

/** The images a PR changed under docs/screenshots/, from `gh pr diff --name-only`. */
export function changedScreenshots(nameOnly: string): string[] {
  return nameOnly
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.startsWith(SCREENSHOTS_DIR) && /\.(png|jpe?g|gif|webp)$/i.test(l) && !/\.diff\.png$/i.test(l));
}

/** A UI state the ticket names while the PR changed no screenshot cannot be seen, so it is cannot_tell. */
export function unseenStates(states: Criterion[]): CheckedEntry[] {
  return states.map(c => ({criterion: c.id, verdict: 'cannot_tell', missing: 'no_state', evidence: [], demoted: 'the PR changed no screenshot under docs/screenshots/'}));
}

/**
 * The baselines the owner approved, read from the PR's base and not its head: a
 * PR that approves its own screenshots would otherwise keep them from being judged.
 */
export function baseBaselines(run: CommandRunner, base: string | undefined): BaselineManifest {
  if (!base) return {approved: []};
  try {
    return parseBaselines(run(`git show origin/${base}:${BASELINE_MANIFEST}`));
  } catch {
    return {approved: []};
  }
}

/** The install step of a gates command: its segments up to and including the first that installs. Pure. */
export function installStep(gates: string): string | null {
  const parts = gates.split('&&').map(p => p.trim()).filter(Boolean);
  const at = parts.findIndex(p => /\binstall\b|\bci\b/.test(p));
  return at === -1 ? null : parts.slice(0, at + 1).join(' && ');
}

/** Where the setup command that ran came from. */
export type SetupSource = 'configured' | 'gates' | 'lockfile';

export interface SetupChoice {
  command: string;
  source: SetupSource;
}

/** The frozen install for each lockfile at the root of a copy, in the order they are looked for. */
export const LOCKFILE_INSTALLS: readonly {file: string; command: string}[] = [
  {file: 'bun.lock', command: 'bun install --frozen-lockfile'},
  {file: 'bun.lockb', command: 'bun install --frozen-lockfile'},
  {file: 'package-lock.json', command: 'npm ci'},
  {file: 'pnpm-lock.yaml', command: 'pnpm install --frozen-lockfile'},
  {file: 'yarn.lock', command: 'yarn install --frozen-lockfile'},
  {file: 'uv.lock', command: 'uv sync --frozen'},
  {file: 'Cargo.lock', command: 'cargo fetch --locked'},
];

/**
 * What runs in the verifier's copy before the model starts: the configured command, else the gates'
 * install step, else the frozen install for a lockfile at the root of the copy. A configured empty
 * string turns setup off. Pure; `hasFile` says whether a file exists at the root of the copy.
 */
export function chooseSetup(setup: string | null | undefined, gates: string, hasFile: (name: string) => boolean): SetupChoice | null {
  if (setup !== null && setup !== undefined) {
    const configured = setup.trim();
    return configured ? {command: configured, source: 'configured'} : null;
  }
  const step = installStep(gates);
  if (step) return {command: step, source: 'gates'};
  const found = LOCKFILE_INSTALLS.find(l => hasFile(l.file));
  return found ? {command: found.command, source: 'lockfile'} : null;
}

export const NO_SETUP_WARNING =
  "verify: no setup ran in the verifier's copy: verify.setup is unset, the gates name no install step and the copy has no recognised lockfile at its root; put one in verify.setup in .forger/workloop.config.json";

/** The verifier could not be set up to run: an infrastructure fault, never a verdict on the ticket's criteria. */
export class VerifyInfraError extends Error {
  constructor(message: string) {
    super(`infrastructure error: ${message}`, {cause: message});
    this.name = 'VerifyInfraError';
  }
}

export function verdictFile(dir: string, pr: number, head: string): string {
  return join(dir, `pr-${pr}-${head}.json`);
}

/** Where a non-pass verdict's command log is kept: beside the verdict record, same name. */
export function commandLogFile(dir: string, pr: number, head: string): string {
  return verdictFile(dir, pr, head).replace(/\.json$/, '.commands.jsonl');
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** The ticket's criteria: the issue's Acceptance section on GitHub, `acceptance_criteria` in a file backlog. */
function criteriaFor(run: CommandRunner, opts: VerifyOptions, ticket: string): {criteria: Criterion[]; uiStates: Criterion[]} {
  if (opts.trackerKind === 'github') {
    const issue = issueNumber(ticket);
    if (issue === null) throw new Error(`"${ticket}" is not an issue-<n> ticket`);
    const body = run(`gh issue view ${issue} --json body --jq .body`);
    return {criteria: parseCriteria(body), uiStates: parseUiStates(body)};
  }
  const data = JSON.parse(readFileSync(opts.backlogFile, 'utf-8')) as {features?: Record<string, {acceptance_criteria?: string[]}>};
  const texts = data.features?.[ticket]?.acceptance_criteria;
  if (!texts) throw new Error(`"${ticket}" is not in the backlog`);
  return {criteria: texts.map((text, i) => ({id: `c${i + 1}`, text})), uiStates: []};
}

function inBacklog(file: string, ticket: string): boolean {
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8')) as {features?: Record<string, unknown>};
    return Boolean(data.features && ticket in data.features);
  } catch {
    return false;
  }
}

/** What the engine recorded in the verifier's copy: its files, and the commands run through the log. */
export function copyRecord(root: string, commands: CommandRun[]): CopyRecord {
  return {
    commands,
    fileLines(path) {
      const file = join(root, path);
      if (!existsSync(file) || !statSync(file).isFile()) return null;
      return readFileSync(file, 'utf-8').split('\n').length;
    },
  };
}

/** Decides each "Gates green" criterion from the head's CI checks, waiting for unfinished ones; the verifier model never sees it. */
async function decideGates(run: CommandRunner, opts: VerifyOptions, criteria: Criterion[], rollup: unknown, base: string | undefined, dir: string, head: string): Promise<CheckedEntry[]> {
  const ci = base ? ciConfigured(run, base) : false;
  const pollMs = opts.pollMs ?? 10_000;
  const sleep = opts.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
  const marker = rerunMarker(opts.verdictsDir, opts.pr, head);
  const read = () => withoutVerifyStatus((JSON.parse(run(`gh pr view ${opts.pr} --json statusCheckRollup`)) as {statusCheckRollup?: unknown}).statusCheckRollup);
  const wait = async (c: Criterion, start: GatesGreen, startRollup: unknown): Promise<{result: GatesGreen; rollup: unknown}> => {
    let current = startRollup;
    let result = start;
    for (let waited = 0; result.state === 'pending' && waited < (opts.checksTimeoutMs ?? 0); waited += pollMs) {
      await sleep(pollMs);
      current = read();
      result = decideGatesGreen(c, current, ci);
    }
    return {result, rollup: current};
  };
  const entries: CheckedEntry[] = [];
  for (const c of criteria) {
    let {result, rollup: current} = await wait(c, decideGatesGreen(c, rollup, ci), rollup);
    if (result.state === 'decided' && result.entry.verdict === 'not_met' && failingChecks(current).length > 0 && !alreadyRerun(marker)) {
      const failed = failingChecks(current);
      markRerun(marker);
      const rerun = rerunFailedJobs(run, head);
      if (!rerun.started) {
        result = {state: 'decided', entry: {...result.entry, evidence: [...result.entry.evidence, {kind: 'ci', ref: `rerun not started: ${rerun.why}`}]}};
      } else {
        await sleep(pollMs);
        const fresh = read();
        const again = await wait(c, decideGatesGreen(c, fresh, ci), fresh);
        if (again.result.state === 'decided' && again.result.entry.verdict === 'met') {
          opts.onFlaky?.({pr: opts.pr, head, check: failed.join(', '), tests: rerun.tests});
          result = {state: 'decided', entry: {...again.result.entry, evidence: [...again.result.entry.evidence, {kind: 'ci', ref: `${failed.join(', ')}: failed, then passed on a rerun with no change`}]}};
        } else if (again.result.state === 'decided') {
          result = {state: 'decided', entry: {...again.result.entry, evidence: [...again.result.entry.evidence, {kind: 'ci', ref: 'failed again on a rerun with no change'}]}};
        } else result = again.result;
      }
    }
    if (result.state === 'decided') entries.push(result.entry);
    else if (result.state === 'pending') entries.push(stillPending(c));
    else entries.push(await gatesCommandEntry(run, opts, c, dir, head, marker));
  }
  return entries;
}

/** A repository without CI: the gates command in the copy, and once more when it fails. */
async function gatesCommandEntry(run: CommandRunner, opts: VerifyOptions, c: Criterion, dir: string, head: string, marker: string): Promise<CheckedEntry> {
  if (!opts.gates) return stillPending(c);
  const attempt = (): string | null => {
    try {
      run(`cd ${shellQuote(dir)} && ${opts.gates}`);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };
  const first = attempt();
  if (first === null) return fromGatesCommand(c, opts.gates, true);
  if (alreadyRerun(marker)) return fromGatesCommand(c, opts.gates, false);
  markRerun(marker);
  if (attempt() !== null) return fromGatesCommand(c, opts.gates, false);
  opts.onFlaky?.({pr: opts.pr, head, check: 'the gates command', tests: failedTests(first)});
  return {...fromGatesCommand(c, opts.gates, true), evidence: [{kind: 'command', ref: opts.gates}, {kind: 'command', ref: 'failed, then passed on a rerun with no change'}]};
}

export async function verifyPr(run: CommandRunner, agent: AgentRunner, opts: VerifyOptions): Promise<VerifyResult> {
  const view = JSON.parse(run(`gh pr view ${opts.pr} --json ${PR_FIELDS},headRefName,baseRefName,body`)) as {headRefOid?: string; headRefName?: string; baseRefName?: string; body?: string; statusCheckRollup?: unknown};
  const pr = parsePr(JSON.stringify({...view, statusCheckRollup: withoutVerifyStatus(view.statusCheckRollup)}));
  if (!pr || !view.headRefOid) throw new Error(`cannot read PR #${opts.pr}`);
  const head = view.headRefOid;
  const found = resolveSubject({branch: view.headRefName ?? '', body: view.body ?? '', trackerKind: opts.trackerKind, inBacklog: id => inBacklog(opts.backlogFile, id)});
  const ticket = found.kind === 'ticket' ? found.ticket : `pr-${opts.pr}`;

  const {criteria: acceptance, uiStates} = found.kind === 'ticket' ? criteriaFor(run, opts, ticket) : {criteria: found.criteria, uiStates: []};
  const criteria = [...acceptance, ...uiStates];
  if (acceptance.length === 0) throw new Error(`${ticket} has no acceptance criteria to verify`);

  run(`git fetch origin pull/${opts.pr}/head`);
  const outOfSpace = (e: unknown): never => {
    if (!isOutOfSpace(e)) throw e;
    const cause = e instanceof VerifyInfraError ? e.cause : e instanceof Error ? e.message : String(e);
    throw new VerifyInfraError(outOfSpaceMessage(opts.tmpDir, freeBytes(opts.tmpDir), String(cause)));
  };
  let dir = '';
  try {
    dir = makeScratch(opts.tmpDir, `verify-${opts.pr}-`);
  } catch (e) {
    outOfSpace(e);
  }
  const log = `${dir}.commands.jsonl`;
  const runLogged = opts.runLogged ? `${opts.runLogged} --file ${shellQuote(log)} --root ${shellQuote(dir)}` : undefined;
  try {
    run(`git worktree add --detach ${shellQuote(dir)} ${head}`);
    const setup = chooseSetup(opts.setup, opts.gates ?? '', name => existsSync(join(dir, name)));
    if (!setup && opts.setup === null) opts.warn?.(NO_SETUP_WARNING);
    if (setup) {
      try {
        run(`cd ${shellQuote(dir)} && ${setup.command}`);
      } catch (e) {
        throw new VerifyInfraError(`setup failed in the verifier's copy (${setup.command}): ${(e as Error).message}`);
      }
    }
    let report: SpecReport | null = null;
    try {
      report = opts.specReport?.(dir) ?? null;
    } catch {
      // an unreadable spec decides nothing; every criterion stays with the verifier
    }
    const changed = uiStates.length > 0 ? changedScreenshots(run(`gh pr diff ${opts.pr} --name-only`)) : [];
    const manifest = baseBaselines(run, view.baseRefName);
    const screenshots = withoutBaseline(changed, manifest);
    const approved = changed.filter(c => !screenshots.includes(c));
    const unseen = changed.length === 0 ? uiStates : [];
    const gateCriteria = criteria.filter(isGatesGreen);
    const gatesDecided = gateCriteria.length > 0 ? await decideGates(run, opts, gateCriteria, withoutVerifyStatus(view.statusCheckRollup), view.baseRefName, dir, head) : [];
    const {mechanical: specDecided, remaining: toJudge} = partitionCriteria(criteria.filter(c => !gateCriteria.includes(c)), report);
    const mechanical = [...gatesDecided, ...specDecided, ...unseenStates(unseen)];
    const remaining = toJudge.filter(c => !unseen.includes(c));
    const subject = {pr: opts.pr, head, ticket, verifier: opts.model, at: (opts.now?.() ?? new Date()).toISOString()};
    if (remaining.length === 0) {
      return writeRecord(opts, setup, log, {...subject, verifier: 'spec-check', ...mergeEntries(criteria, mechanical, []), problems: []});
    }
    const diff = run(`gh pr diff ${opts.pr}`);
    const gate = {checks: pr.checks, failing_checks: pr.failing_checks};
    const ask = async (criteriaAsked: Criterion[], failed?: {criterion: string; citations: string[]}[]) => {
      const result = await agent.run({
        prompt: buildVerifierInput({criteria: criteriaAsked, decided: gateCriteria, diff, gate, setupRan: Boolean(setup), screenshots, approved, runLogged, failedCitations: failed}),
        sessionId: opts.sessionId,
        tier: opts.tier,
        model: opts.model,
        workerCommand: opts.verifierCommand,
        cwd: dir,
        readOnly: true,
        ref: `pull/${opts.pr}/head`,
        timeoutMinutes: opts.timeoutMinutes,
        killGraceSeconds: opts.killGraceSeconds,
      });
      const commands = existsSync(log) ? parseCommandLog(readFileSync(log, 'utf-8')) : [];
      const record = copyRecord(dir, commands);
      const holds = (e: Parameters<typeof evidenceHolds>[1]) => evidenceHolds(record, e);
      const judged = recordVerdict(subject, criteriaAsked, result.output, holds);
      return {holds, judged: {...judged, entries: noteCutOutput(judged.entries, commands)}};
    };
    const first = await ask(remaining);
    let judged = first.judged;
    const redo = judged.problems.length === 0 ? judged.entries.filter(e => e.demoted?.startsWith(EVIDENCE_DEMOTION)) : [];
    if (redo.length > 0) {
      const failed = redo.map(e => ({criterion: e.criterion, citations: failedCitations(e.evidence, first.holds)}));
      const second = await ask(remaining.filter(c => redo.some(e => e.criterion === c.id)), failed);
      if (second.judged.problems.length === 0) {
        const again = new Map(second.judged.entries.map(e => [e.criterion, e]));
        judged = {...judged, entries: judged.entries.map(e => again.get(e.criterion) ?? e)};
        judged = {...judged, decision: reduceVerdict(judged.entries)};
      }
    }
    return writeRecord(opts, setup, log, {...judged, ...mergeEntries(criteria, mechanical, judged.entries), problems: judged.problems});
  } catch (e) {
    return outOfSpace(e);
  } finally {
    rmSync(log, {force: true});
    dropCheckout(run, dir);
  }
}

/** Removes the checkout and its folder; a worktree git cannot remove is pruned once its folder is gone. */
export function dropCheckout(run: CommandRunner, dir: string): void {
  let removed = true;
  try {
    run(`git worktree remove --force ${shellQuote(dir)}`);
  } catch {
    removed = false;
  }
  removeScratch(dir);
  if (removed) return;
  try {
    run('git worktree prune');
  } catch {
    // a stale worktree entry is pruned by git itself later; it holds no space
  }
}

function writeRecord(opts: VerifyOptions, setup: SetupChoice | null, log: string, base: VerdictRecord): VerifyResult {
  mkdirSync(opts.verdictsDir, {recursive: true});
  const kept = commandLogFile(opts.verdictsDir, base.pr, base.head);
  const unchecked = base.entries.some(e => e.demoted?.startsWith(EVIDENCE_DEMOTION));
  let commandLog: string | null = null;
  rmSync(kept, {force: true});
  if ((base.decision !== 'pass' || unchecked) && existsSync(log)) {
    renameSync(log, kept);
    commandLog = kept;
  }
  const record: VerdictRecord = {...base, setup, commandLog};
  writeFileSync(verdictFile(opts.verdictsDir, record.pr, record.head), JSON.stringify(record, null, 2) + '\n');
  if (opts.trackerKind !== 'github' || !opts.capture) return record;
  return {...record, status: setVerifyStatus(opts.capture, record.head, record.decision)};
}
