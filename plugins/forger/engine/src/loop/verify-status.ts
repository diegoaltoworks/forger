/**
 * The verifier's verdict as a GitHub commit status, `forger/verify`, and the
 * base branch protection that requires it. The status makes the verdict a gate
 * GitHub enforces: with the check required, a merge that skipped `verify` is
 * refused by GitHub itself, not discovered after it landed. Everything goes
 * through the injected runner; the mapping from a decision is pure.
 */

import type {CapturingRunner, CommandResult} from '../ports';
import type {Decision} from './verdict';

export const VERIFY_STATUS_CONTEXT = 'forger/verify';

export interface VerifyStatus {
  state: 'success' | 'failure';
  description: string;
}

/** Only a pass is success: an unclear verdict blocks a merge exactly as a failing one does. */
export function verifyStatusFor(decision: Decision): VerifyStatus {
  return {state: decision === 'pass' ? 'success' : 'failure', description: `verdict: ${decision}`};
}

/** What setting the status did; `error` is set when GitHub refused it. */
export interface VerifyStatusOutcome {
  context: string;
  state: VerifyStatus['state'];
  error?: string;
}

function q(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function failure(r: CommandResult): string {
  return r.stderr || r.stdout || `exit ${r.exitCode}`;
}

/** A status is bound to the commit: a push after a pass leaves the new head without one until `verify` runs again. */
export function setVerifyStatus(run: CapturingRunner, head: string, decision: Decision): VerifyStatusOutcome {
  const s = verifyStatusFor(decision);
  const r = run(
    `gh api -X POST repos/{owner}/{repo}/statuses/${head} -f state=${s.state} -f context=${q(VERIFY_STATUS_CONTEXT)} -f description=${q(s.description)}`
  );
  return r.exitCode === 0 ? {context: VERIFY_STATUS_CONTEXT, state: s.state} : {context: VERIFY_STATUS_CONTEXT, state: s.state, error: failure(r)};
}

/** A PR's check rollup without the verdict's own status, so the verifier never judges its previous verdict as a gate. */
export function withoutVerifyStatus(rollup: unknown): unknown {
  if (!Array.isArray(rollup)) return rollup;
  return rollup.filter(e => (e as {context?: string | null}).context !== VERIFY_STATUS_CONTEXT);
}

function protectionPath(branch: string): string {
  return `repos/{owner}/{repo}/branches/${encodeURIComponent(branch)}/protection`;
}

function notFound(r: CommandResult): boolean {
  return r.exitCode !== 0 && /HTTP 404/.test(`${r.stderr}\n${r.stdout}`);
}

type ChecksRead = {kind: 'checks'; names: string[]} | {kind: 'none'} | {kind: 'unreadable'; error: string};

function readRequiredChecks(run: CapturingRunner, branch: string): ChecksRead {
  const r = run(`gh api ${protectionPath(branch)}/required_status_checks`);
  if (notFound(r)) return {kind: 'none'};
  if (r.exitCode !== 0) return {kind: 'unreadable', error: failure(r)};
  try {
    const checks = JSON.parse(r.stdout) as {contexts?: string[]; checks?: {context?: string}[]};
    return {kind: 'checks', names: [...(checks.contexts ?? []), ...(checks.checks ?? []).map(c => c.context ?? '')]};
  } catch {
    return {kind: 'unreadable', error: `unreadable answer: ${r.stdout.slice(0, 200)}`};
  }
}

/**
 * Whether the base branch requires `forger/verify`: true or false when GitHub
 * answered, null when the protection could not be read (no gh, no admin
 * rights, a plan without protection on private repositories). A 404 means the
 * branch requires no status checks at all.
 */
export function requiresVerifyStatus(run: CapturingRunner, branch: string): boolean | null {
  const read = readRequiredChecks(run, branch);
  if (read.kind === 'unreadable') return null;
  return read.kind === 'checks' && read.names.includes(VERIFY_STATUS_CONTEXT);
}

export interface RequireOutcome {
  /** True when the check was already required or is now. */
  required: boolean;
  /** True when this call changed the protection. */
  added: boolean;
  error?: string;
}

/**
 * Adds `forger/verify` to the base branch's required checks, keeping every
 * other rule. A branch with no protection gets one that requires only this
 * check and applies to administrators too: the worker usually holds the
 * owner's token, and an admin bypass would let a hand merge through.
 */
export function requireVerifyStatus(run: CapturingRunner, branch: string): RequireOutcome {
  const path = protectionPath(branch);
  const refused = (r: CommandResult): RequireOutcome => ({required: false, added: false, error: failure(r)});
  const read = readRequiredChecks(run, branch);
  if (read.kind === 'unreadable') return {required: false, added: false, error: read.error};
  if (read.kind === 'checks') {
    if (read.names.includes(VERIFY_STATUS_CONTEXT)) return {required: true, added: false};
    const r = run(`gh api -X POST ${path}/required_status_checks/contexts -f ${q(`contexts[]=${VERIFY_STATUS_CONTEXT}`)}`);
    return r.exitCode === 0 ? {required: true, added: true} : refused(r);
  }
  const existing = run(`gh api ${path}`);
  if (existing.exitCode === 0) {
    const r = run(`gh api -X PATCH ${path}/required_status_checks -F strict=false -f ${q(`contexts[]=${VERIFY_STATUS_CONTEXT}`)}`);
    return r.exitCode === 0 ? {required: true, added: true} : refused(r);
  }
  if (!notFound(existing)) return refused(existing);
  const body = JSON.stringify({
    required_status_checks: {strict: false, contexts: [VERIFY_STATUS_CONTEXT]},
    enforce_admins: true,
    required_pull_request_reviews: null,
    restrictions: null,
  });
  const r = run(`printf '%s' ${q(body)} | gh api -X PUT ${path} --input -`);
  return r.exitCode === 0 ? {required: true, added: true} : refused(r);
}

export function missingVerifyStatusAnomaly(branch: string): string {
  return `${branch} does not require the ${VERIFY_STATUS_CONTEXT} check, so GitHub allows a merge with no passing verdict; run setup, or add it to the branch protection`;
}
