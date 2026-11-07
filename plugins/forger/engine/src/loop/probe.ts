/**
 * A ticket's `Probe`: commands that measure the assumption the ticket rests on,
 * run on the host before a worker is spent. Each probe is a list item holding
 * a backticked command and its expected result in the forms criteria use:
 * "exits N", "prints "text"" or "prints a number of at least N". Pure over
 * ticket text and command results; the running sits in the caller.
 */

import type {CommandResult} from '../ports';

const HEADING = /^#{1,6}\s+(.*?)\s*$/;
const ITEM = /^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/;

export type Expectation =
  | {kind: 'exit'; code: number}
  | {kind: 'prints'; text: string}
  | {kind: 'at-least'; n: number};

export interface Probe {
  command: string;
  /** The expected result as the ticket words it. */
  expected: string;
  /** Null when the words fit none of the forms. */
  expectation: Expectation | null;
}

const AT_LEAST = /\bprints?\s+(?:a\s+)?(?:number|count|value)\s+(?:of\s+)?(?:at\s+least|>=)\s*(\d+(?:\.\d+)?)/i;
const PRINTS = /\bprints?\s+(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/i;
const EXITS = /\bexit(?:s|ed)?(?:\s+with)?(?:\s+code)?\s+(\d+)\b/i;

/** The expectation a probe's words state; null when they state none. */
export function parseExpectation(text: string): Expectation | null {
  const atLeast = AT_LEAST.exec(text);
  if (atLeast) return {kind: 'at-least', n: Number(atLeast[1])};
  const prints = PRINTS.exec(text);
  if (prints) return {kind: 'prints', text: prints[1] ?? prints[2] ?? prints[3] ?? ''};
  const exits = EXITS.exec(text);
  if (exits) return {kind: 'exit', code: Number(exits[1])};
  return null;
}

/** The list items under a ticket's `Probe` heading, without HTML comments; `none` names no probe. */
export function parseProbes(body: string | null | undefined): Probe[] {
  if (!body) return [];
  const probes: Probe[] = [];
  let inSection = false;
  for (const line of body.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading) {
      inSection = /^probes?\s*:?$/i.test(heading[1]);
      continue;
    }
    const item = inSection ? ITEM.exec(line) : null;
    if (!item) continue;
    const text = item[1];
    if (/^none\.?$/i.test(text)) continue;
    const command = /`([^`]+)`/.exec(text);
    if (!command) {
      probes.push({command: '', expected: text, expectation: null});
      continue;
    }
    const expected = text.slice(command.index + command[0].length).trim();
    probes.push({command: command[1], expected, expectation: parseExpectation(expected)});
  }
  return probes;
}

/** What is wrong with each probe line of a ticket; empty when it has none or all are fit to run. */
export function checkProbes(body: string): string[] {
  const problems: string[] = [];
  for (const p of parseProbes(body)) {
    if (p.command === '') {
      problems.push(`probe "${p.expected}" names no command; put the command in backticks, then its expected result`);
    } else if (p.expectation === null) {
      problems.push(`probe \`${p.command}\` has no expected result; say "exits 0", prints "text" or prints a number of at least N`);
    }
  }
  return problems;
}

/** The command's output, as the probe compares it. */
function outputOf(r: CommandResult): string {
  return r.stdout.trim();
}

/** Whether the command's result is the expected one. */
export function probeHolds(e: Expectation, r: CommandResult): boolean {
  switch (e.kind) {
    case 'exit':
      return r.exitCode === e.code;
    case 'prints':
      return outputOf(r).includes(e.text);
    case 'at-least': {
      const n = Number(/-?\d+(?:\.\d+)?/.exec(outputOf(r))?.[0]);
      return Number.isFinite(n) && n >= e.n;
    }
  }
}

const SHOWN = 500;

/** What a command did, in a line the owner can compare with the expectation. */
export function actualOf(r: CommandResult): string {
  const out = outputOf(r) || r.stderr.trim();
  const shown = out.length > SHOWN ? `${out.slice(0, SHOWN)}...` : out;
  return `exit ${r.exitCode}${shown === '' ? ', no output' : `, output: ${shown}`}`;
}

export interface ProbeRun {
  probe: Probe;
  result: CommandResult;
  holds: boolean;
}

/** Runs the probes in order and stops at the first that fails, so a later one never runs on a broken assumption. */
export function runProbes(probes: Probe[], run: (command: string) => CommandResult): ProbeRun[] {
  const runs: ProbeRun[] = [];
  for (const probe of probes) {
    const result = run(probe.command);
    const holds = probe.expectation !== null && probeHolds(probe.expectation, result);
    runs.push({probe, result, holds});
    if (!holds) break;
  }
  return runs;
}

/** The first probe that did not hold; null when all did. */
export function failedProbe(runs: ProbeRun[]): ProbeRun | null {
  return runs.find(r => !r.holds) ?? null;
}

/** The comment that hands a ticket back: the command, the expected and the actual result. */
export function probeFailureComment(run: ProbeRun): string {
  return [
    'A probe of this ticket failed before any worker started, so no run was spent.',
    '',
    `- Command: \`${run.probe.command}\``,
    `- Expected: ${run.probe.expected}`,
    `- Actual: ${actualOf(run.result)}`,
    '',
    'The ticket rests on an assumption that does not hold. Change the ticket or the code it rests on, then relabel it for the agent.',
  ].join('\n');
}

/** The prompt section that gives the worker what the probes measured; empty when there were none. */
export function probePromptSection(runs: ProbeRun[]): string {
  if (runs.length === 0) return '';
  const lines = runs.map(r => `- \`${r.probe.command}\` (expected: ${r.probe.expected}) -> ${actualOf(r.result)}`);
  return ['## Probe output', 'The ticket\'s probes held on the base branch before you started:', ...lines].join('\n');
}
