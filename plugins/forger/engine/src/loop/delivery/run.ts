import {existsSync, readFileSync} from 'fs';

import {DELIVER_PATH, parseDeliverConfig, planDelivery, type PlannedStep, type StepName} from '../../checks';
import {forgerPath} from '../../config';
import type {CommandResult, CommandRunner, ProbeRunner} from '../../ports';
import type {EventKind} from '../events';
import {DELIVERY_FAILED_TITLE, DELIVERY_LABEL, failureBody, prReason} from './outcome';

export interface DeliveryDeps {
  projectRoot: string;
  base: string;
  intakeLabel: string;
  /** git and gh calls in the main checkout. */
  run: CommandRunner;
  /** Runs the project's own commands with a time limit. */
  probe: ProbeRunner;
  iteration: number;
  ticket: string | null;
  emit(kind: EventKind, iteration: number, ticket: string | null, reason: string | null): void;
  halt(reason: string): void;
  warn(message: string): void;
}

const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

function outputOf(r: CommandResult): string {
  return `${r.stdout}\n${r.stderr}`.trim();
}

function describe(step: PlannedStep, r: CommandResult): string {
  return r.exitCode === 124 ? `\`${step.command}\` ran past its ${step.timeout_seconds}s limit` : `\`${step.command}\` exited ${r.exitCode}`;
}

/** The PR that merged the ticket's branch; null when the tracker cannot say. */
function mergedPr(run: CommandRunner, ticket: string | null): number | null {
  if (ticket === null) return null;
  try {
    const n = Number(run(`gh pr list --state merged --head ${quote(`feat/${ticket}`)} --json number --jq ".[0].number"`).trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** One issue per run of failures: an open one gets a comment instead. */
function reportFailure(d: DeliveryDeps, pr: number | null, step: string, detail: string, output: string): void {
  const body = failureBody(pr, step, detail, output);
  try {
    const open = d.run(`gh issue list --label ${DELIVERY_LABEL} --state open --search ${quote(`${DELIVERY_FAILED_TITLE} in:title`)} --json number,title --jq ".[] | select(.title == \\"${DELIVERY_FAILED_TITLE}\\") | .number"`).trim().split('\n')[0];
    if (open) d.run(`gh issue comment ${open} --body ${quote(body)}`);
    else d.run(`gh issue create --title ${quote(DELIVERY_FAILED_TITLE)} --body ${quote(body)} --label ${quote(d.intakeLabel)} --label ${DELIVERY_LABEL}`);
  } catch (e) {
    d.warn(`Could not file the delivery failure: ${(e as Error).message}`);
  }
}

/**
 * Runs the delivery pack's plan for a merged ticket. A failed step is
 * recorded, filed and rolled back when a rollback is configured; only a
 * failed rollback halts, since the delivered build is then broken with no way
 * back.
 */
export function runDelivery(d: DeliveryDeps): void {
  const file = forgerPath(d.projectRoot, DELIVER_PATH);
  if (!existsSync(file)) return;
  const {config, findings} = parseDeliverConfig(readFileSync(file, 'utf-8'));
  if (config === null) {
    d.warn(`Delivery skipped: ${DELIVER_PATH} is invalid (${findings.map(f => f.detail).join('; ')})`);
    return;
  }
  const pr = mergedPr(d.run, d.ticket);
  const fail = (step: string, detail: string, output: string, plan: PlannedStep | null): void => {
    d.emit('delivery_failed', d.iteration, d.ticket, prReason(pr, `${step}: ${detail}`));
    reportFailure(d, pr, step, detail, output);
    if (plan === null) return;
    const r = d.probe(plan.command, d.projectRoot, plan.timeout_seconds * 1000);
    if (r.exitCode === 0) {
      d.emit('rolled_back', d.iteration, d.ticket, prReason(pr, `${plan.command} undid the delivery`));
      return;
    }
    const why = `${describe(plan, r)}`;
    d.emit('rollback_failed', d.iteration, d.ticket, prReason(pr, why));
    d.halt(`The rollback after a failed delivery failed (${why}); the delivered build is broken with no way back`);
  };

  try {
    d.run(`git fetch --quiet origin ${d.base}`);
    d.run(`git merge --ff-only origin/${d.base}`);
  } catch (e) {
    fail('sync', `the checkout could not be brought to the merged commit: ${(e as Error).message}`, (e as Error).message, null);
    return;
  }

  const plan = planDelivery(config);
  for (const step of plan.steps) {
    const r = d.probe(step.command, d.projectRoot, step.timeout_seconds * 1000);
    if (r.exitCode !== 0) {
      fail(step.name, describe(step, r), outputOf(r), plan.onFailure(step.name as StepName));
      return;
    }
  }
  d.emit('delivered', d.iteration, d.ticket, prReason(pr, 'deployed and checked'));
}
