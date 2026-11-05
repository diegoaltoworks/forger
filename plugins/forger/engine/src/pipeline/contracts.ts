/**
 * Output contracts (ADR 0016 section 2): the shape of what a slot's skill leaves
 * for the next stage, and a pure validator per contract over the parsed result
 * plus facts the caller passes in. `verdict`, `pr_body` and `rebase_clean` are
 * validated by the loop's own validators, wired in `cli/contract.ts`.
 */

export type ContractName =
  | 'decisions'
  | 'glossary_entries'
  | 'wireframe'
  | 'concepts'
  | 'tests_written'
  | 'diagnosis'
  | 'review_findings'
  | 'risk_report'
  | 'pr_body'
  | 'rebase_clean'
  | 'verdict'
  | 'retro_proposals';

/** The contract each built-in slot leaves. A slot an overlay adds names its own contract in the definition. */
export const CONTRACT_FOR_SLOT: Readonly<Record<string, ContractName>> = {
  interview: 'decisions',
  glossary: 'glossary_entries',
  design: 'wireframe',
  prototype: 'concepts',
  test_first: 'tests_written',
  diagnose: 'diagnosis',
  review: 'review_findings',
  risk: 'risk_report',
  pr_body: 'pr_body',
  merge_conflicts: 'rebase_clean',
  verify: 'verdict',
  retro: 'retro_proposals',
};

export const CONTRACT_NAMES = [...new Set(Object.values(CONTRACT_FOR_SLOT))] as ContractName[];

export function contractForSlot(slot: string): ContractName | undefined {
  return CONTRACT_FOR_SLOT[slot];
}

/** What the caller knows that the result cannot vouch for itself. */
export interface ContractFacts {
  /** Paths the branch's diff touches. */
  diffPaths: string[];
  /** The ticket's acceptance criteria, as `verdict.ts` parses them. */
  criteria: Array<{id: string; text: string}>;
  /** The gates command, for `diagnose` to hold the reproduced command against. */
  gateCommand: string | null;
  fileExists: (path: string) => boolean;
  /** Whether a file's text contains a term. */
  fileContains: (path: string, term: string) => boolean;
  isTestFile: (path: string) => boolean;
}

export const NO_FACTS: ContractFacts = {
  diffPaths: [],
  criteria: [],
  gateCommand: null,
  fileExists: () => false,
  fileContains: () => false,
  isTestFile: () => false,
};

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function entries(value: unknown, what: string, problems: string[]): Obj[] | null {
  if (!Array.isArray(value)) {
    problems.push(`${what} must be an array`);
    return null;
  }
  return value.map((v, i) => {
    if (isObj(v)) return v;
    problems.push(`${what}[${i}] must be an object`);
    return {};
  });
}

function decisions(value: unknown): string[] {
  if (isObj(value) && value.none === true) return [];
  const problems: string[] = [];
  const list = entries(value, 'decisions', problems);
  if (!list) return problems;
  if (list.length === 0) problems.push('decisions is empty: give at least one entry, or {"none": true}');
  list.forEach((e, i) => {
    if (!text(e.question)) problems.push(`decisions[${i}] has no question`);
    if (!text(e.answer)) problems.push(`decisions[${i}] has no answer`);
    if (e.source !== 'owner' && e.source !== 'default') problems.push(`decisions[${i}] source must be "owner" or "default"`);
    if (e.source === 'default' && (!text(e.recommended) || e.answer !== e.recommended)) {
      problems.push(`decisions[${i}] is a default answer, so its answer must be the recommended one`);
    }
  });
  return problems;
}

function glossaryEntries(value: unknown, f: ContractFacts): string[] {
  const problems: string[] = [];
  const list = entries(value, 'glossary_entries', problems);
  list?.forEach((e, i) => {
    const subject = text(e.term) ? e.term : text(e.adr) ? e.adr : null;
    if (subject === null) problems.push(`glossary_entries[${i}] names neither a term nor an adr`);
    if (!text(e.file)) {
      problems.push(`glossary_entries[${i}] has no file`);
      return;
    }
    if (!f.diffPaths.includes(e.file)) problems.push(`glossary_entries[${i}] file ${e.file} is not in the diff`);
    else if (text(e.term) && !f.fileContains(e.file, e.term)) problems.push(`glossary_entries[${i}] term "${e.term}" does not appear in ${e.file}`);
  });
  return problems;
}

function wireframe(value: unknown, f: ContractFacts): string[] {
  if (!isObj(value)) return ['wireframe must be an object with html and png paths'];
  const problems: string[] = [];
  for (const [key, ext] of [['html', '.html'], ['png', '.png']] as const) {
    const p = value[key];
    if (!text(p)) problems.push(`wireframe has no ${key} path`);
    else if (!p.endsWith(ext)) problems.push(`wireframe ${key} ${p} is not a ${ext} file`);
    else if (!f.fileExists(p)) problems.push(`wireframe ${key} ${p} does not exist`);
  }
  return problems;
}

function concepts(value: unknown, f: ContractFacts): string[] {
  const problems: string[] = [];
  const list = entries(value, 'concepts', problems);
  if (!list) return problems;
  if (list.length < 2 || list.length > 3) problems.push(`concepts must hold two or three concepts, got ${list.length}`);
  const paths = new Set<string>();
  list.forEach((e, i) => {
    const at = `concepts[${i}]`;
    if (!text(e.path)) problems.push(`${at} has no path`);
    else if (!e.path.endsWith('.html')) problems.push(`${at} path ${e.path} is not a .html file`);
    else if (!f.fileExists(e.path)) problems.push(`${at} path ${e.path} does not exist`);
    else if (paths.has(e.path)) problems.push(`${at} path ${e.path} repeats an earlier concept`);
    else paths.add(e.path);
    if (!text(e.axis)) problems.push(`${at} names no axis`);
    if (!text(e.pitch)) problems.push(`${at} has no pitch`);
    else if (/\r|\n/.test(e.pitch.trim())) problems.push(`${at} pitch must be one line`);
  });
  return problems;
}

function testsWritten(value: unknown, f: ContractFacts): string[] {
  const problems: string[] = [];
  const list = entries(value, 'tests_written', problems);
  if (!list) return problems;
  const named = new Set<string>();
  list.forEach((e, i) => {
    const crit = f.criteria.find(c => c.id === e.criterion || c.text === e.criterion);
    if (!crit) problems.push(`tests_written[${i}] names criterion ${JSON.stringify(e.criterion)}, which the ticket does not have`);
    else named.add(crit.id);
    if (text(e.waived)) return;
    if (!text(e.file)) problems.push(`tests_written[${i}] has no file`);
    else if (!f.diffPaths.includes(e.file)) problems.push(`tests_written[${i}] file ${e.file} is not in the diff`);
    else if (!f.isTestFile(e.file)) problems.push(`tests_written[${i}] file ${e.file} is not a test file`);
    if (!text(e.test)) problems.push(`tests_written[${i}] names no test`);
  });
  for (const c of f.criteria) {
    if (!named.has(c.id)) problems.push(`criterion ${c.id} has no test and no waiver: ${c.text}`);
  }
  return problems;
}

function diagnosis(value: unknown, f: ContractFacts): string[] {
  if (!isObj(value)) return ['diagnosis must be an object'];
  const problems: string[] = [];
  if (!text(value.command)) problems.push('diagnosis has no command');
  else if (f.gateCommand !== null && !f.gateCommand.includes(value.command.trim())) {
    problems.push(`diagnosis command "${value.command}" is not the red gate or a part of it`);
  }
  if (!int(value.exit)) problems.push('diagnosis exit must be an integer');
  else if (value.exit === 0) problems.push('diagnosis exit is 0: the reproduced command must fail');
  if (!text(value.excerpt)) problems.push('diagnosis excerpt is empty');
  if (!text(value.hypothesis)) problems.push('diagnosis has no hypothesis');
  if (value.result !== 'confirmed' && value.result !== 'refuted') problems.push('diagnosis result must be "confirmed" or "refuted"');
  return problems;
}

const SEVERITIES = ['low', 'medium', 'high', 'critical'];

function reviewFindings(value: unknown, f: ContractFacts): string[] {
  const problems: string[] = [];
  const list = entries(value, 'review_findings', problems);
  list?.forEach((e, i) => {
    const at = `review_findings[${i}]`;
    if (typeof e.severity !== 'string' || !SEVERITIES.includes(e.severity)) problems.push(`${at} severity must be one of ${SEVERITIES.join(', ')}`);
    if (!text(e.file)) problems.push(`${at} has no file`);
    else if (!f.diffPaths.includes(e.file)) problems.push(`${at} file ${e.file} is not in the diff`);
    if (!int(e.line) || e.line < 1) problems.push(`${at} line must be a positive integer`);
    if (!text(e.summary)) problems.push(`${at} has no summary`);
    const needs = e.severity !== 'low';
    if (e.disposition === undefined && needs) problems.push(`${at} is ${String(e.severity)} and has no disposition`);
    else if (e.disposition !== undefined && e.disposition !== 'fixed' && e.disposition !== 'declined') problems.push(`${at} disposition must be "fixed" or "declined"`);
    else if (e.disposition === 'declined' && !text(e.reason)) problems.push(`${at} is declined without a reason`);
  });
  return problems;
}

function riskReport(value: unknown): string[] {
  if (!isObj(value)) return ['risk_report must be an object'];
  const problems: string[] = [];
  const beyond = entries(value.beyond_diff, 'risk_report.beyond_diff', problems);
  beyond?.forEach((e, i) => {
    if (!text(e.path)) problems.push(`risk_report.beyond_diff[${i}] has no path`);
    if (!text(e.why)) problems.push(`risk_report.beyond_diff[${i}] has no why`);
  });
  const ran = entries(value.ran, 'risk_report.ran', problems);
  ran?.forEach((e, i) => {
    if (!text(e.command)) problems.push(`risk_report.ran[${i}] has no command`);
    if (!int(e.exit)) problems.push(`risk_report.ran[${i}] has no exit code`);
  });
  return problems;
}

const RUNGS = ['check', 'test', 'tool', 'doc'];

function retroProposals(value: unknown): string[] {
  const problems: string[] = [];
  const list = entries(value, 'retro_proposals', problems);
  list?.forEach((e, i) => {
    if (!text(e.lesson)) problems.push(`retro_proposals[${i}] has no lesson`);
    if (typeof e.rung !== 'string' || !RUNGS.includes(e.rung)) problems.push(`retro_proposals[${i}] rung must be one of ${RUNGS.join(', ')}`);
    if (!text(e.target)) problems.push(`retro_proposals[${i}] names no target path`);
  });
  return problems;
}

/** The contracts forger validates itself, as pure functions. The others are validated by the loop's validators. */
export const VALIDATORS: Partial<Record<ContractName, (value: unknown, facts: ContractFacts) => string[]>> = {
  decisions: v => decisions(v),
  glossary_entries: glossaryEntries,
  wireframe,
  concepts,
  tests_written: testsWritten,
  diagnosis,
  review_findings: reviewFindings,
  risk_report: v => riskReport(v),
  retro_proposals: v => retroProposals(v),
};

export interface ContractResult {
  ok: boolean;
  problems: string[];
}

/** Validates a parsed result. A contract this module does not own is a problem, not a pass. */
export function validateContract(contract: ContractName, value: unknown, facts: ContractFacts): ContractResult {
  const validator = VALIDATORS[contract];
  if (!validator) return {ok: false, problems: [`contract ${contract} is validated by the loop, not here`]};
  const problems = validator(value, facts);
  return {ok: problems.length === 0, problems};
}
