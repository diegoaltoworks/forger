import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'fs';
import {join} from 'path';

import {CONTRACT_FOR_SLOT, CONTRACT_NAMES, NO_FACTS, validateContract, type ContractFacts, type ContractName} from './contracts';
import type {Definition} from './types';

const facts: ContractFacts = {
  diffPaths: ['src/a.ts', 'src/a.test.ts', 'GLOSSARY.md'],
  criteria: [
    {id: 'c1', text: 'it works'},
    {id: 'c2', text: 'it is documented'},
  ],
  gateCommand: 'bun run check && bun test',
  fileExists: p => p === 'w/index.html' || p === 'w/index.png',
  fileContains: (p, term) => p === 'GLOSSARY.md' && term === 'Slot',
  isTestFile: p => p.endsWith('.test.ts'),
};

interface Case {
  name: string;
  contract: ContractName;
  value: unknown;
  problems: string[];
}

const cases: Case[] = [
  {name: 'decisions good', contract: 'decisions', value: [{question: 'q', answer: 'a', source: 'owner', recommended: 'a'}], problems: []},
  {name: 'decisions explicit none', contract: 'decisions', value: {none: true}, problems: []},
  {name: 'decisions not an array', contract: 'decisions', value: 'x', problems: ['decisions must be an array']},
  {name: 'decisions empty', contract: 'decisions', value: [], problems: ['decisions is empty: give at least one entry, or {"none": true}']},
  {
    name: 'decisions every problem',
    contract: 'decisions',
    value: [{question: '', answer: '', source: 'guess'}],
    problems: ['decisions[0] has no question', 'decisions[0] has no answer', 'decisions[0] source must be "owner" or "default"'],
  },
  {
    name: 'decisions default differs from recommended',
    contract: 'decisions',
    value: [{question: 'q', answer: 'a', source: 'default', recommended: 'b'}],
    problems: ['decisions[0] is a default answer, so its answer must be the recommended one'],
  },
  {name: 'glossary good', contract: 'glossary_entries', value: [{term: 'Slot', file: 'GLOSSARY.md'}, {adr: 'ADR 1', file: 'src/a.ts'}], problems: []},
  {
    name: 'glossary problems',
    contract: 'glossary_entries',
    value: [{file: 'GLOSSARY.md'}, {term: 'Slot'}, {term: 'Slot', file: 'other.md'}, {term: 'Missing', file: 'GLOSSARY.md'}],
    problems: [
      'glossary_entries[0] names neither a term nor an adr',
      'glossary_entries[1] has no file',
      'glossary_entries[2] file other.md is not in the diff',
      'glossary_entries[3] term "Missing" does not appear in GLOSSARY.md',
    ],
  },
  {name: 'wireframe good', contract: 'wireframe', value: {html: 'w/index.html', png: 'w/index.png'}, problems: []},
  {name: 'wireframe not an object', contract: 'wireframe', value: [], problems: ['wireframe must be an object with html and png paths']},
  {
    name: 'wireframe problems',
    contract: 'wireframe',
    value: {html: 'w/missing.html', png: 'w/index.jpg'},
    problems: ['wireframe html w/missing.html does not exist', 'wireframe png w/index.jpg is not a .png file'],
  },
  {name: 'wireframe no paths', contract: 'wireframe', value: {}, problems: ['wireframe has no html path', 'wireframe has no png path']},
  {
    name: 'tests_written good with a waiver',
    contract: 'tests_written',
    value: [{criterion: 'c1', file: 'src/a.test.ts', test: 'works'}, {criterion: 'it is documented', waived: 'docs only'}],
    problems: [],
  },
  {
    name: 'tests_written problems',
    contract: 'tests_written',
    value: [{criterion: 'c9', file: 'src/a.ts', test: ''}, {criterion: 'c1', file: 'src/b.test.ts', test: 't'}],
    problems: [
      'tests_written[0] names criterion "c9", which the ticket does not have',
      'tests_written[0] file src/a.ts is not a test file',
      'tests_written[0] names no test',
      'tests_written[1] file src/b.test.ts is not in the diff',
      'criterion c2 has no test and no waiver: it is documented',
    ],
  },
  {name: 'tests_written no file', contract: 'tests_written', value: [{criterion: 'c1', test: 't'}, {criterion: 'c2', waived: 'x'}], problems: ['tests_written[0] has no file']},
  {name: 'diagnosis good', contract: 'diagnosis', value: {command: 'bun test', exit: 1, excerpt: 'fail', hypothesis: 'h', result: 'confirmed'}, problems: []},
  {
    name: 'diagnosis problems',
    contract: 'diagnosis',
    value: {command: 'make', exit: 0, excerpt: ' ', hypothesis: '', result: 'maybe'},
    problems: [
      'diagnosis command "make" is not the red gate or a part of it',
      'diagnosis exit is 0: the reproduced command must fail',
      'diagnosis excerpt is empty',
      'diagnosis has no hypothesis',
      'diagnosis result must be "confirmed" or "refuted"',
    ],
  },
  {name: 'diagnosis bare', contract: 'diagnosis', value: {}, problems: ['diagnosis has no command', 'diagnosis exit must be an integer', 'diagnosis excerpt is empty', 'diagnosis has no hypothesis', 'diagnosis result must be "confirmed" or "refuted"']},
  {
    name: 'review good',
    contract: 'review_findings',
    value: [
      {severity: 'high', file: 'src/a.ts', line: 3, summary: 's', disposition: 'fixed'},
      {severity: 'medium', file: 'src/a.ts', line: 4, summary: 's', disposition: 'declined', reason: 'intended'},
      {severity: 'low', file: 'src/a.ts', line: 5, summary: 'nit'},
    ],
    problems: [],
  },
  {name: 'review none found', contract: 'review_findings', value: [], problems: []},
  {
    name: 'review problems',
    contract: 'review_findings',
    value: [
      {severity: 'urgent', file: 'src/z.ts', line: 0, summary: ''},
      {severity: 'medium', file: 'src/a.ts', line: 1, summary: 's', disposition: 'declined'},
      {severity: 'low', file: 'src/a.ts', line: 1, summary: 's', disposition: 'later'},
    ],
    problems: [
      'review_findings[0] severity must be one of low, medium, high, critical',
      'review_findings[0] file src/z.ts is not in the diff',
      'review_findings[0] line must be a positive integer',
      'review_findings[0] has no summary',
      'review_findings[0] is urgent and has no disposition',
      'review_findings[1] is declined without a reason',
      'review_findings[2] disposition must be "fixed" or "declined"',
    ],
  },
  {name: 'review not an array', contract: 'review_findings', value: {}, problems: ['review_findings must be an array']},
  {name: 'risk good', contract: 'risk_report', value: {beyond_diff: [{path: 'x', why: 'y'}], ran: [{command: 'c', exit: 0}]}, problems: []},
  {name: 'risk not an object', contract: 'risk_report', value: null, problems: ['risk_report must be an object']},
  {
    name: 'risk problems',
    contract: 'risk_report',
    value: {beyond_diff: [{path: '', why: ''}], ran: [{command: '', exit: 'ok'}]},
    problems: ['risk_report.beyond_diff[0] has no path', 'risk_report.beyond_diff[0] has no why', 'risk_report.ran[0] has no command', 'risk_report.ran[0] has no exit code'],
  },
  {name: 'risk missing lists', contract: 'risk_report', value: {}, problems: ['risk_report.beyond_diff must be an array', 'risk_report.ran must be an array']},
  {name: 'retro good', contract: 'retro_proposals', value: [{lesson: 'l', rung: 'check', target: 'a/b.ts'}], problems: []},
  {
    name: 'retro problems',
    contract: 'retro_proposals',
    value: [{lesson: '', rung: 'wish', target: ''}],
    problems: ['retro_proposals[0] has no lesson', 'retro_proposals[0] rung must be one of check, test, tool, doc', 'retro_proposals[0] names no target path'],
  },
  {name: 'entry not an object', contract: 'retro_proposals', value: ['x'], problems: ['retro_proposals[0] must be an object', 'retro_proposals[0] has no lesson', 'retro_proposals[0] rung must be one of check, test, tool, doc', 'retro_proposals[0] names no target path']},
];

describe('validateContract', () => {
  test.each(cases)('$name', ({contract, value, problems}) => {
    const r = validateContract(contract, value, facts);
    expect(r.problems).toEqual(problems);
    expect(r.ok).toBe(problems.length === 0);
  });

  test('every contract this module owns has a good and a bad case', () => {
    const owned = new Set(cases.map(c => c.contract));
    for (const c of CONTRACT_NAMES.filter(n => !['pr_body', 'rebase_clean', 'verdict'].includes(n))) expect(owned.has(c)).toBe(true);
  });

  test('a contract the loop validates is not passed here', () => {
    expect(validateContract('verdict', [], NO_FACTS).ok).toBe(false);
  });

  test('diagnosis without a configured gate checks no command', () => {
    const r = validateContract('diagnosis', {command: 'x', exit: 2, excerpt: 'e', hypothesis: 'h', result: 'refuted'}, {...facts, gateCommand: null});
    expect(r.ok).toBe(true);
  });
});

describe('the slot table', () => {
  test('agrees with the shipped definition', () => {
    const def = JSON.parse(readFileSync(join(import.meta.dir, '../../../pipeline/default.json'), 'utf-8')) as Definition;
    for (const stage of def.stages) for (const s of stage.slots) expect(CONTRACT_FOR_SLOT[s.slot]).toBe(s.contract as ContractName);
  });
});
