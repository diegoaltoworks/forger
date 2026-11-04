/**
 * The contract suffix: one string per contract, generated from the contract's
 * shape, telling a skill where to write its result and in what shape. It follows
 * the unattended preamble on every slot invocation.
 */

import type {ContractName} from './contracts';

interface Shape {
  format: 'json' | 'markdown';
  /** An example of the result; absent for markdown. */
  example?: unknown;
  rules: string[];
}

export const SHAPES: Readonly<Record<ContractName, Shape>> = {
  decisions: {
    format: 'json',
    example: [{question: 'text', answer: 'text', source: 'owner|default', recommended: 'text'}],
    rules: ['Give at least one entry, or {"none": true} when nothing was open.', 'A "default" answer must be the recommended one.'],
  },
  glossary_entries: {
    format: 'json',
    example: [{term: 'text', file: 'path'}, {adr: 'text', file: 'path'}],
    rules: ['Each file is in your changes and, for a term, contains it.'],
  },
  wireframe: {
    format: 'json',
    example: {html: 'path.html', png: 'path.png'},
    rules: ['Both files exist; capture the png with the screenshot command.'],
  },
  concepts: {
    format: 'json',
    example: [{path: 'docs/progress/prototype/a.html', axis: 'watch vs play', pitch: 'one line'}],
    rules: ['Give two or three concepts, each a single HTML file that exists and opens on its own.', 'Each concept names the axis it varies; the pitch is one line.'],
  },
  tests_written: {
    format: 'json',
    example: [{criterion: 'c1', file: 'path', test: 'test name'}, {criterion: 'c2', waived: 'reason'}],
    rules: ['Name every acceptance criterion of the ticket, or waive it with a reason.', 'Each file is a test file in your changes.'],
  },
  diagnosis: {
    format: 'json',
    example: {command: 'text', exit: 1, excerpt: 'text', hypothesis: 'text', result: 'confirmed|refuted'},
    rules: ['The command is the red gate or a part of it and its exit is non-zero.', 'The excerpt is the failing output.'],
  },
  review_findings: {
    format: 'json',
    example: [{severity: 'low|medium|high|critical', file: 'path', line: 1, summary: 'text', disposition: 'fixed|declined', reason: 'text'}],
    rules: ['Each file is in the diff.', 'Every finding at medium or above has a disposition; a declined one has a reason.'],
  },
  risk_report: {
    format: 'json',
    example: {beyond_diff: [{path: 'path', why: 'text'}], ran: [{command: 'text', exit: 0}]},
    rules: ['Every command you ran has its exit code.', 'The report informs the worker; it is not a verdict.'],
  },
  pr_body: {
    format: 'markdown',
    rules: ['Keep the "Closes #<issue>" line and the review sections the ticket names.'],
  },
  rebase_clean: {
    format: 'json',
    example: {status: 'clean'},
    rules: ['Write the output of the rebase command with --json once the rebase is clean.'],
  },
  verdict: {
    format: 'json',
    example: [{criterion: 'c1', verdict: 'met|not_met|cannot_tell', evidence: [{kind: 'file|command|test|check', ref: 'text'}]}],
    rules: ['Judge every criterion of the ticket once.', 'A met or not_met criterion carries evidence that resolves.'],
  },
  retro_proposals: {
    format: 'json',
    example: [{lesson: 'text', rung: 'check|test|tool|doc', target: 'path'}],
    rules: ['Each proposal names a rung of the refinement ladder and a target path.'],
  },
};

/** Where a slot's result goes, relative to the run's directory. */
export function resultFile(slot: string, contract: ContractName): string {
  return `${slot}.${SHAPES[contract].format === 'markdown' ? 'md' : 'json'}`;
}

export function contractSuffix(contract: ContractName, path: string): string {
  const shape = SHAPES[contract];
  const head =
    shape.format === 'markdown'
      ? `When you finish, write your result to ${path} as markdown.`
      : `When you finish, write your result to ${path} as JSON in this shape: ${JSON.stringify(shape.example)}.`;
  return [head, ...shape.rules].join(' ');
}
