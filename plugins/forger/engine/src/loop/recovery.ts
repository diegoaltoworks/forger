/**
 * Halts the engine can recover by itself. The table maps a halt's event kind
 * to the one action taken; a reason absent from it keeps the HALT and the
 * report quotes the recommended action. Pure: the checks and writes sit
 * behind the injected ports of `recover`.
 */

import type {Decision} from './verdict';
import type {EventKind, TerminalEvent} from './events';

export type RecoveryAction =
  | {action: 'verify_merged_head'}
  | {action: 'keep'; recommendation: string};

const KEEP: Record<string, string> = {
  merged_red: 'fix the base branch, or revert the red merge, then resume with --cause <issue>',
  halted: 'check for a pushed branch with no merged PR, finish or discard it, then resume with --cause <issue>',
  stalled: 'read the worker log for why nothing changed, then resume with --cause <issue>',
  timed_out: 'check whether the worker pushed a branch before it was killed, open its PR if so, then resume with --cause <issue>',
  too_many_failures: 'read the last failure, fix its cause, then resume with --cause <issue>',
  runner_gone: 'check the branch for unmerged work, then resume with --cause <issue>',
};

const FALLBACK = 'look at the halt reason and the branch, then resume with --cause <issue> or --not-a-defect "<why>"';

/** The recovery for a halt of this kind. */
export function recoveryFor(kind: string): RecoveryAction {
  if (kind === 'unverified') return {action: 'verify_merged_head'};
  return {action: 'keep', recommendation: Object.hasOwn(KEEP, kind) ? KEEP[kind] : FALLBACK};
}

/** The one action to recommend for a halt kind the engine cannot recover. */
export function recommendationFor(kind: string | null): string {
  if (kind === null) return FALLBACK;
  const r = recoveryFor(kind);
  return r.action === 'keep' ? r.recommendation : 'run `recover`: the engine verifies the merged head and resumes on a pass';
}

const HALTING: readonly string[] = ['merged_red', 'unverified', 'halted', 'stalled', 'timed_out', 'too_many_failures', 'runner_gone'];
const ENDS_HALT: readonly string[] = ['halt_cleared', 'recovered'];

/** The halt still standing: the last halting event with no clear or recovery after it. */
export function standingHalt(events: TerminalEvent[]): TerminalEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const k: EventKind = events[i].event;
    if (ENDS_HALT.includes(k)) return null;
    if (HALTING.includes(k)) return events[i];
  }
  return null;
}

/** The PR an unverified halt names, from its reason. */
export function mergedPrOf(reason: string | null): number | null {
  const m = /PR #(\d+)/.exec(reason ?? '');
  return m ? Number(m[1]) : null;
}

export interface RecoveryPorts {
  /** Verify the merged PR's head; resolves its decision and the unmet criteria. */
  verify(pr: number): Promise<{decision: Decision; open: string[]}>;
  /** File a ticket and return a handle for it (an issue URL). */
  fileTicket(title: string, body: string): string;
  /** End the halt and write the `recovered` event with this detail. */
  resume(detail: string): void;
}

export interface RecoveryResult {
  recovered: boolean;
  kind: string;
  /** What happened, or what to do, in a sentence. */
  detail: string;
  ticket?: string;
}

export async function recover(halt: TerminalEvent | null, ports: RecoveryPorts): Promise<RecoveryResult> {
  if (halt === null) return {recovered: false, kind: 'none', detail: 'no halt is standing'};
  const kind = halt.event;
  const plan = recoveryFor(kind);
  if (plan.action === 'keep') return {recovered: false, kind, detail: plan.recommendation};
  const pr = mergedPrOf(halt.reason);
  if (pr === null) return {recovered: false, kind, detail: 'the halt names no PR to verify; review what landed, then resume with --cause <issue>'};
  const v = await ports.verify(pr);
  if (v.decision === 'pass') {
    const detail = `PR #${pr} verified after the merge: pass`;
    ports.resume(detail);
    return {recovered: true, kind, detail};
  }
  const ticket = ports.fileTicket(
    `Revert or fix PR #${pr}: verified ${v.decision} after it merged`,
    `PR #${pr} merged with no passing verdict. The verifier now says ${v.decision}.\n\nOpen criteria:\n${v.open.map(o => `- ${o}`).join('\n') || '- none named'}\n`
  );
  return {recovered: false, kind, detail: `PR #${pr} verified ${v.decision}; the HALT stays and ${ticket} asks for the revert`, ticket};
}
