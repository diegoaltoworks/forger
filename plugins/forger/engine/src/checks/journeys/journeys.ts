/**
 * The pure half of `check journeys`: the config, the shell wrappers that let a
 * plain runner tell a failed command from silence, and the verdicts. Pure.
 */

import type {Gap} from '../gaps';
import type {Finding} from '../waivers';

export const JOURNEYS_PATH = '.forger/journeys.json';
export const NAMED_OPINION = 'journeys.named';
export const PASS_OPINION = 'journeys.pass';
export const DEFAULT_READY_SECONDS = 30;

export interface Journey {
  name: string;
  /** Exercises the journey against the running build; exits non-zero when it fails. */
  command: string;
  /** Globs of the code the journey runs through. */
  paths: string[];
}

export interface JourneysConfig {
  journeys: Journey[];
  /** Starts the app; it stays up for the whole run. */
  start?: string;
  /** Exits 0 once the app is up. */
  ready?: string;
  ready_seconds: number;
}

export class JourneysConfigError extends Error {
  constructor(problem: string) {
    super(`${JOURNEYS_PATH}: ${problem}`);
  }
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

function parseJourney(raw: unknown, index: number): Journey {
  const at = `journeys[${index}]`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new JourneysConfigError(`${at} must be an object`);
  const obj = raw as Record<string, unknown>;
  if (!isText(obj.name)) throw new JourneysConfigError(`${at} needs a "name"`);
  const label = `${at} ("${obj.name.trim()}")`;
  if (!isText(obj.command)) throw new JourneysConfigError(`${label} needs a "command"`);
  if (!Array.isArray(obj.paths) || obj.paths.length === 0 || obj.paths.some(p => !isText(p))) {
    throw new JourneysConfigError(`${label} needs "paths", a non-empty list of globs`);
  }
  return {name: obj.name.trim(), command: obj.command.trim(), paths: (obj.paths as string[]).map(p => p.trim())};
}

export function parseJourneysConfig(text: string): JourneysConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new JourneysConfigError('is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new JourneysConfigError('must be an object');
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.journeys)) throw new JourneysConfigError('"journeys" must be a list');
  for (const key of ['start', 'ready'] as const) {
    if (obj[key] !== undefined && !isText(obj[key])) throw new JourneysConfigError(`"${key}" must be a non-empty command`);
  }
  const seconds = obj.ready_seconds;
  if (seconds !== undefined && (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 1)) {
    throw new JourneysConfigError('"ready_seconds" must be a whole number of seconds, 1 or more');
  }
  const journeys = obj.journeys.map(parseJourney);
  const dup = journeys.find((j, i) => journeys.findIndex(o => o.name === j.name) !== i);
  if (dup) throw new JourneysConfigError(`two journeys are named "${dup.name}"`);
  return {
    journeys,
    ...(isText(obj.start) ? {start: obj.start.trim()} : {}),
    ...(isText(obj.ready) ? {ready: obj.ready.trim()} : {}),
    ready_seconds: typeof seconds === 'number' ? seconds : DEFAULT_READY_SECONDS,
  };
}

const EXIT_MARK = 'forger-journey-exit:';
const PID_MARK = 'forger-journey-pid:';
const TAIL_LINES = 15;
/** Exit statuses a shell gives when the command was found but not run (126) or not found (127). */
const NOT_STARTED = new Set([126, 127]);

/** The command run through a shell that reports its exit status in the output. */
export function exitShellCommand(command: string): string {
  return `(
${command}
) 2>&1; printf '\\n${EXIT_MARK}%s\\n' "$?"`;
}

/** Starts the app in its own process group and reports the pid. */
export function startShellCommand(command: string): string {
  return `setsid sh -c '${command.replace(/'/g, `'\\''`)}' >/dev/null 2>&1 & printf '${PID_MARK}%s\\n' "$!"`;
}

export function parsePid(output: string): number | null {
  const at = output.lastIndexOf(PID_MARK);
  const pid = at < 0 ? NaN : Number(output.slice(at + PID_MARK.length).trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** Ends the app's process group; tolerant of an app that already exited. */
export function stopShellCommand(pid: number): string {
  return `kill -TERM -- -${pid} 2>/dev/null; kill -TERM ${pid} 2>/dev/null; true`;
}

/** Polls `ready` once a second; exits 0 when it did, 1 when the seconds ran out. */
export function waitShellCommand(ready: string, seconds: number): string {
  return `i=0; while [ "$i" -lt ${seconds} ]; do
  if (
${ready}
  ) >/dev/null 2>&1; then printf '${EXIT_MARK}0\\n'; exit 0; fi
  i=$((i+1)); sleep 1
done; printf '${EXIT_MARK}1\\n'`;
}

export interface Outcome {
  /** null when the shell never reported a status. */
  code: number | null;
  tail: string;
}

export function outcomeOf(output: string): Outcome {
  const at = output.lastIndexOf(EXIT_MARK);
  if (at < 0) return {code: null, tail: output.trim().split('\n').slice(-TAIL_LINES).join('\n')};
  const code = Number(output.slice(at + EXIT_MARK.length).trim());
  return {code: Number.isNaN(code) ? null : code, tail: output.slice(0, at).trim().split('\n').slice(-TAIL_LINES).join('\n')};
}

const finding = (rule: string, detail: string): Finding => ({file: JOURNEYS_PATH, line: 1, rule, opinion: PASS_OPINION, detail});

/** A journey that did not exit 0 is one finding naming it and the end of its output. */
export function judgeJourney(journey: Journey, output: string): Finding[] {
  const {code, tail} = outcomeOf(output);
  const end = tail ? `\n${tail}` : '';
  if (code === 0) return [];
  if (code === null || NOT_STARTED.has(code)) return [finding('journey-cannot-start', `journey "${journey.name}" could not be run: ${journey.command}${end}`)];
  return [finding('journey-failed', `journey "${journey.name}" exited ${code}: ${journey.command}${end}`)];
}

export function judgeReady(config: JourneysConfig, output: string): Finding[] {
  const {code} = outcomeOf(output);
  return code === 0 ? [] : [finding('app-not-ready', `the app was not ready within ${config.ready_seconds}s: ${config.ready}`)];
}

export function judgeStart(config: JourneysConfig): Finding[] {
  return [finding('app-cannot-start', `the app could not be started: ${config.start}`)];
}

/** No journey named is a gap, not a pass: nothing says what a person must be able to do. */
export function namedGaps(config: JourneysConfig): Gap[] {
  if (config.journeys.length > 0) return [];
  return [{file: JOURNEYS_PATH, opinion: NAMED_OPINION, modality: 'SHOULD', detail: 'no journey is named'}];
}
