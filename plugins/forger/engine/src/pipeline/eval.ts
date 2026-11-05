/**
 * Evals for slot skills (ADR 0016 section 3): the cases a slot's skill is run
 * on, and the scoring of one result against a case. Scoring is pure - the slot's
 * contract validator plus the case's properties; only producing the result is a
 * model's.
 */

import {CONTRACT_FOR_SLOT, NO_FACTS, TEST_FILE, validateContract, type ContractFacts, type ContractName} from './contracts';

export type Severity = 'low' | 'medium' | 'high' | 'critical';
const ORDER: Severity[] = ['low', 'medium', 'high', 'critical'];

/** A property a good result has. */
export type EvalProperty =
  /** A review finding at the planted defect: this file, a line within `tolerance` (default 2) of `line`, at `minSeverity` or above (default medium). */
  | {kind: 'finding'; file: string; line: number; tolerance?: number; minSeverity?: Severity}
  /** The result's text contains every term, ignoring case. */
  | {kind: 'text'; terms: string[]; label?: string}
  /** No more than `count` findings at `minSeverity` or above (default low): a clean diff is not flagged. */
  | {kind: 'at_most'; count: number; minSeverity?: Severity};

/** What `case.json` holds; the files beside it are the input the skill is given. */
export interface EvalCase {
  name: string;
  /** The task text handed to the skill. */
  input: string;
  /** What the contract validator needs to know about the case's world. */
  facts: {diffPaths?: string[]; criteria?: Array<{id: string; text: string}>; gateCommand?: string | null; files?: Record<string, string>};
  properties: EvalProperty[];
}

export interface PropertyScore {
  property: string;
  met: boolean;
}

export interface CaseScore {
  case: string;
  /** The contract held and every property was met. */
  passed: boolean;
  /** The fraction of properties met; 0 when the contract failed or there is no result. */
  score: number;
  contract: {ok: boolean; problems: string[]};
  properties: PropertyScore[];
}

export interface EvalSummary {
  slot: string;
  skill: string;
  cases: CaseScore[];
  passed: number;
  total: number;
  /** The mean of the cases' scores. */
  score: number;
}

export function evalContract(slot: string): ContractName | undefined {
  return CONTRACT_FOR_SLOT[slot];
}

function factsFor(c: EvalCase): ContractFacts {
  const files = c.facts.files ?? {};
  return {
    ...NO_FACTS,
    diffPaths: c.facts.diffPaths ?? [],
    criteria: c.facts.criteria ?? [],
    gateCommand: c.facts.gateCommand ?? null,
    fileExists: p => p in files,
    fileContains: (p, term) => (files[p] ?? '').includes(term),
    isTestFile: p => TEST_FILE.test(p),
  };
}

const rank = (s: unknown): number => ORDER.indexOf(s as Severity);

function findings(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null) : [];
}

export function describeProperty(p: EvalProperty): string {
  if (p.kind === 'finding') return `finds a ${p.minSeverity ?? 'medium'}+ defect at ${p.file}:${p.line}`;
  if (p.kind === 'text') return p.label ?? `mentions ${p.terms.join(', ')}`;
  return `at most ${p.count} finding(s) at ${p.minSeverity ?? 'low'}+`;
}

export function propertyMet(p: EvalProperty, value: unknown, raw: string): boolean {
  if (p.kind === 'text') {
    const text = raw.toLowerCase();
    return p.terms.every(t => text.includes(t.toLowerCase()));
  }
  const floor = rank(p.minSeverity ?? (p.kind === 'finding' ? 'medium' : 'low'));
  const list = findings(value);
  if (p.kind === 'at_most') return list.filter(f => rank(f.severity) >= floor).length <= p.count;
  return list.some(f => f.file === p.file && typeof f.line === 'number' && Math.abs(f.line - p.line) <= (p.tolerance ?? 2) && rank(f.severity) >= floor);
}

/** Scores one raw result (the text the skill left, or null when it left none) against a case. */
export function scoreCase(slot: string, c: EvalCase, raw: string | null): CaseScore {
  const contract = evalContract(slot);
  const properties = (met: boolean, value: unknown, text: string): PropertyScore[] => c.properties.map(p => ({property: describeProperty(p), met: met && propertyMet(p, value, text)}));
  if (!contract) return {case: c.name, passed: false, score: 0, contract: {ok: false, problems: [`no contract for slot "${slot}"`]}, properties: properties(false, null, '')};
  if (raw === null) return {case: c.name, passed: false, score: 0, contract: {ok: false, problems: ['the skill wrote no result']}, properties: properties(false, null, '')};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    return {case: c.name, passed: false, score: 0, contract: {ok: false, problems: [`the result is not valid JSON: ${(e as Error).message}`]}, properties: properties(false, null, '')};
  }
  const {ok, problems} = validateContract(contract, value, factsFor(c));
  const props = properties(true, value, raw);
  const met = props.filter(p => p.met).length;
  return {
    case: c.name,
    passed: ok && met === props.length,
    score: !ok ? 0 : props.length === 0 ? 1 : met / props.length,
    contract: {ok, problems},
    properties: props,
  };
}

export function summarise(slot: string, skill: string, cases: CaseScore[]): EvalSummary {
  const score = cases.length === 0 ? 0 : cases.reduce((n, c) => n + c.score, 0) / cases.length;
  return {slot, skill, cases, passed: cases.filter(c => c.passed).length, total: cases.length, score};
}

/** The prompt one case is run with: the skill to follow, the input, and where to write the result. */
export function evalPrompt(opts: {preamble: string; skill: {name: string} | {file: string}; input: string; suffix: string}): string {
  const how = 'name' in opts.skill ? `Invoke the skill ${opts.skill.name}.` : `Read the file ${opts.skill.file} and follow it.`;
  return [
    'This is an evaluation of one skill on one case, not a ticket: do nothing beyond this task, whatever else you were told to run.',
    opts.preamble,
    how,
    'The case:',
    opts.input,
    opts.suffix,
  ].join('\n\n');
}
