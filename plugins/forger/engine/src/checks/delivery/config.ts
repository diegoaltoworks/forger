/**
 * The pure half of `check delivery`: the config in `.forger/deliver.json`, its
 * validation and the plan a delivery follows. Pure; it runs no command.
 */

import type {Finding} from '../waivers';

export const DELIVER_PATH = '.forger/deliver.json';
export const CHECKED_OPINION = 'delivery.checked-after-merge';
export const DEFAULT_TIMEOUT_SECONDS = 300;

export const STEP_NAMES = ['deploy', 'check', 'rollback'] as const;
export type StepName = (typeof STEP_NAMES)[number];

export interface DeliverConfig {
  /** Exits 0 when the delivered build works. */
  check: string;
  deploy?: string;
  rollback?: string;
  timeout_seconds: Record<StepName, number>;
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

const finding = (opinion: string, detail: string): Finding => ({
  file: DELIVER_PATH,
  line: 1,
  rule: opinion,
  opinion,
  detail,
});

/**
 * Validates the text of a deliver file. Returns the config, or the findings
 * that say what is wrong; never throws, never runs a command.
 */
export function parseDeliverConfig(text: string): {config: DeliverConfig | null; findings: Finding[]} {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {config: null, findings: [finding(CHECKED_OPINION, 'is not valid JSON')]};
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {config: null, findings: [finding(CHECKED_OPINION, 'must be an object')]};
  }
  const obj = raw as Record<string, unknown>;
  const findings: Finding[] = [];
  if (obj.check === undefined) findings.push(finding(CHECKED_OPINION, 'has no "check" command; a delivery nothing verifies is not done'));
  for (const name of STEP_NAMES) {
    if (obj[name] !== undefined && !isText(obj[name])) findings.push(finding(CHECKED_OPINION, `"${name}" must be a non-empty command`));
  }
  if (obj.check !== undefined && !isText(obj.check)) findings.push(finding(CHECKED_OPINION, '"check" must be a non-empty command'));

  const timeouts: Record<StepName, number> = {deploy: DEFAULT_TIMEOUT_SECONDS, check: DEFAULT_TIMEOUT_SECONDS, rollback: DEFAULT_TIMEOUT_SECONDS};
  const given = obj.timeout_seconds;
  if (given !== undefined) {
    if (typeof given !== 'object' || given === null || Array.isArray(given)) {
      findings.push(finding(CHECKED_OPINION, '"timeout_seconds" must be an object keyed by step'));
    } else {
      for (const [key, value] of Object.entries(given as Record<string, unknown>)) {
        if (!(STEP_NAMES as readonly string[]).includes(key)) findings.push(finding(CHECKED_OPINION, `"timeout_seconds.${key}" names no step`));
        else if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
          findings.push(finding(CHECKED_OPINION, `"timeout_seconds.${key}" must be a positive number`));
        } else timeouts[key as StepName] = value;
      }
    }
  }
  if (findings.length > 0) return {config: null, findings};
  const trimmed = (v: unknown): string | undefined => (isText(v) ? v.trim() : undefined);
  const deploy = trimmed(obj.deploy);
  const rollback = trimmed(obj.rollback);
  return {
    config: {
      check: (obj.check as string).trim(),
      ...(deploy !== undefined ? {deploy} : {}),
      ...(rollback !== undefined ? {rollback} : {}),
      timeout_seconds: timeouts,
    },
    findings: [],
  };
}

export interface PlannedStep {
  name: StepName;
  command: string;
  timeout_seconds: number;
}

export interface DeliveryPlan {
  /** In order: deploy when configured, then check. */
  steps: PlannedStep[];
  /** What follows a failed step: the rollback when configured, else nothing. */
  onFailure: (failed: StepName) => PlannedStep | null;
}

/** Pure: the ordered steps of a delivery and what follows a failure. */
export function planDelivery(config: DeliverConfig): DeliveryPlan {
  const step = (name: StepName, command: string): PlannedStep => ({name, command, timeout_seconds: config.timeout_seconds[name]});
  const steps = [...(config.deploy !== undefined ? [step('deploy', config.deploy)] : []), step('check', config.check)];
  const rollback = config.rollback !== undefined ? step('rollback', config.rollback) : null;
  return {steps, onFailure: failed => (failed === 'rollback' ? null : rollback)};
}
