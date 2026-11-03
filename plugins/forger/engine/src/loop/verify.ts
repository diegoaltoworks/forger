/**
 * `verify --pr N`: run the fresh-context verifier on a PR's head and write the
 * record `merge` will read (ADR 0010). The input is built by `verify-input.ts`;
 * everything that touches the world (gh, git, the checkout, the agent, files)
 * sits here behind the injected runner and agent.
 */

import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {isAbsolute, join, normalize} from 'path';

import type {Tier} from '../config';
import type {AgentRunner, CommandRunner, SpecReport} from '../ports';
import {issueNumber} from './decline';
import {PR_FIELDS, parsePr} from './pr-checks';
import {mergeEntries, partitionCriteria} from './mechanical';
import {parseCriteria, type Criterion, type Evidence} from './verdict';
import {buildVerifierInput, recordVerdict, type VerdictRecord} from './verify-input';

export interface VerifyOptions {
  pr: number;
  trackerKind: 'github' | 'local' | 'none';
  backlogFile: string;
  /** Directory holding the verdict records. */
  verdictsDir: string;
  tier: Tier;
  model: string;
  /** The command the harness is asked to run; it carries the verifier's prompt. */
  verifierCommand: string;
  timeoutMinutes: number;
  killGraceSeconds: number;
  sessionId: string;
  /** The spec report of the head checkout; null or absent when there is no spec to bind criteria to. */
  specReport?: (checkoutDir: string) => SpecReport | null;
  now?: () => Date;
}

export function verdictFile(dir: string, pr: number, head: string): string {
  return join(dir, `pr-${pr}-${head}.json`);
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** The ticket's criteria: the issue's Acceptance section on GitHub, `acceptance_criteria` in a file backlog. */
function criteriaFor(run: CommandRunner, opts: VerifyOptions, ticket: string): Criterion[] {
  if (opts.trackerKind === 'github') {
    const issue = issueNumber(ticket);
    if (issue === null) throw new Error(`"${ticket}" is not an issue-<n> ticket`);
    return parseCriteria(run(`gh issue view ${issue} --json body --jq .body`));
  }
  const data = JSON.parse(readFileSync(opts.backlogFile, 'utf-8')) as {features?: Record<string, {acceptance_criteria?: string[]}>};
  const texts = data.features?.[ticket]?.acceptance_criteria;
  if (!texts) throw new Error(`"${ticket}" is not in the backlog`);
  return texts.map((text, i) => ({id: `c${i + 1}`, text}));
}

/** Whether a piece of evidence points at something in the checkout. A command is taken as cited: the verifier ran it, and the validator does not re-run it. */
export function evidenceResolves(run: CommandRunner, root: string, e: Evidence): boolean {
  const ref = (e.ref ?? '').trim();
  if (ref === '') return false;
  if (e.kind === 'command') return true;
  // Only the engine's own spec check is evidence of kind check; a verifier cannot claim it.
  if (e.kind === 'check') return false;
  if (e.kind === 'test') {
    try {
      return run(`git -C ${shellQuote(root)} grep -F -l -e ${shellQuote(ref)}`).trim() !== '';
    } catch {
      return false;
    }
  }
  const m = /^(.*?)(?::(\d+))?$/.exec(ref);
  const path = normalize(m?.[1] ?? ref);
  if (isAbsolute(path) || path.startsWith('..')) return false;
  const file = join(root, path);
  if (!existsSync(file)) return false;
  if (!m?.[2]) return true;
  return parseInt(m[2], 10) >= 1 && parseInt(m[2], 10) <= readFileSync(file, 'utf-8').split('\n').length;
}

export async function verifyPr(run: CommandRunner, agent: AgentRunner, opts: VerifyOptions): Promise<VerdictRecord> {
  const view = JSON.parse(run(`gh pr view ${opts.pr} --json ${PR_FIELDS},headRefName`)) as {headRefOid?: string; headRefName?: string};
  const pr = parsePr(JSON.stringify(view));
  if (!pr || !view.headRefOid) throw new Error(`cannot read PR #${opts.pr}`);
  const head = view.headRefOid;
  const ticket = /^feat\/(issue-\d+)$/.exec(view.headRefName ?? '')?.[1];
  if (!ticket) throw new Error(`cannot tell the ticket from branch "${view.headRefName ?? ''}"; expected feat/issue-<n>`);

  const criteria = criteriaFor(run, opts, ticket);
  if (criteria.length === 0) throw new Error(`${ticket} has no acceptance criteria to verify`);

  run(`git fetch origin pull/${opts.pr}/head`);
  const dir = mkdtempSync(join(tmpdir(), `forger-verify-${opts.pr}-`));
  run(`git worktree add --detach ${shellQuote(dir)} ${head}`);
  try {
    let report: SpecReport | null = null;
    try {
      report = opts.specReport?.(dir) ?? null;
    } catch {
      // an unreadable spec decides nothing; every criterion stays with the verifier
    }
    const {mechanical, remaining} = partitionCriteria(criteria, report);
    const subject = {pr: opts.pr, head, ticket, verifier: opts.model, at: (opts.now?.() ?? new Date()).toISOString()};
    if (remaining.length === 0) {
      return writeRecord(opts, {...subject, verifier: 'spec-check', ...mergeEntries(criteria, mechanical, []), problems: []});
    }
    // Read-only so the verifier cannot edit what it judges.
    run(`chmod -R a-w ${shellQuote(dir)}`);
    const prompt = buildVerifierInput({criteria: remaining, diff: run(`gh pr diff ${opts.pr}`), gate: {checks: pr.checks, failing_checks: pr.failing_checks}});
    const result = await agent.run({
      prompt,
      sessionId: opts.sessionId,
      tier: opts.tier,
      model: opts.model,
      workerCommand: opts.verifierCommand,
      cwd: dir,
      timeoutMinutes: opts.timeoutMinutes,
      killGraceSeconds: opts.killGraceSeconds,
    });
    const judged = recordVerdict(subject, remaining, result.output, e => evidenceResolves(run, dir, e));
    return writeRecord(opts, {...judged, ...mergeEntries(criteria, mechanical, judged.entries), problems: judged.problems});
  } finally {
    run(`chmod -R u+w ${shellQuote(dir)}`);
    run(`git worktree remove --force ${shellQuote(dir)}`);
  }
}

function writeRecord(opts: VerifyOptions, record: VerdictRecord): VerdictRecord {
  mkdirSync(opts.verdictsDir, {recursive: true});
  writeFileSync(verdictFile(opts.verdictsDir, record.pr, record.head), JSON.stringify(record, null, 2) + '\n');
  return record;
}
