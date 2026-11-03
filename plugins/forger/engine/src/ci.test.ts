import {describe, expect, test} from 'bun:test';
import {readdirSync, readFileSync, statSync} from 'fs';
import {join} from 'path';

import {buildReport} from './checks';
import {formatSummary, gatesDrift, unwaitedMerges, WORKFLOW_PATH, workflowRuns} from './ci';
import type {Finding, Waiver} from './waivers';

const REPO = join(import.meta.dir, '../../../..');
const PLUGIN = join(import.meta.dir, '../..');

const opinions = [
  {id: 'base.ascii-punctuation', check: 'docs'},
  {id: 'base.nothing-personal', check: 'docs'},
  {id: 'arch.layers', check: 'arch'},
];
const finding: Finding = {file: 'a.md', line: 3, rule: 'non-ascii', opinion: 'base.ascii-punctuation', detail: 'U+2014'};
const waiver: Waiver = {opinion: 'base.ascii-punctuation', path: 'a.md', reason: 'quoted | verbatim', approved_by: 'owner'};

describe('formatSummary', () => {
  const cases: Array<{name: string; findings: Array<{check: string; findings: Finding[]}>; waivers: Waiver[]; head: string; rows: string[]; extra: string[]}> = [
    {
      name: 'all pass',
      findings: [{check: 'docs', findings: []}, {check: 'arch', findings: []}],
      waivers: [],
      head: '## forger check: passed',
      rows: ['| docs | `base.ascii-punctuation`, `base.nothing-personal` | passed | 0 | 0 |', '| arch | `arch.layers` | passed | 0 | 0 |'],
      extra: ['### Waivers in force', 'None.'],
    },
    {
      name: 'one failure',
      findings: [{check: 'docs', findings: [finding]}, {check: 'arch', findings: []}],
      waivers: [],
      head: '## forger check: failed',
      rows: ['| docs | `base.ascii-punctuation`, `base.nothing-personal` | **failed** | 1 | 0 |', '| arch | `arch.layers` | passed | 0 | 0 |'],
      extra: ['### Open findings', '- `a.md:3` base.ascii-punctuation: U+2014'],
    },
    {
      name: 'one waived',
      findings: [{check: 'docs', findings: [finding]}, {check: 'arch', findings: []}],
      waivers: [waiver],
      head: '## forger check: passed',
      rows: ['| docs | `base.ascii-punctuation`, `base.nothing-personal` | waived | 0 | 1 |', '| arch | `arch.layers` | passed | 0 | 0 |'],
      extra: ['| `base.ascii-punctuation` | `a.md` | quoted \\| verbatim | owner |'],
    },
  ];
  for (const c of cases) {
    test(c.name, () => {
      const text = formatSummary(buildReport(c.findings, c.waivers, opinions));
      const lines = text.split('\n');
      expect(lines[0]).toBe(c.head);
      for (const row of [...c.rows, ...c.extra]) expect(lines).toContain(row);
    });
  }

  test('a waiver that matches nothing is marked stale', () => {
    const text = formatSummary(buildReport([{check: 'docs', findings: []}], [waiver], opinions));
    expect(text).toContain('`base.ascii-punctuation` (stale)');
  });

  test('no checks declared', () => {
    expect(formatSummary(buildReport([], []))).toContain('No checks declared');
  });

  test('a check with no installed opinion shows a dash', () => {
    expect(formatSummary(buildReport([{check: 'safety', findings: []}], []))).toContain('| safety | - | passed | 0 | 0 |');
  });
});

describe('workflowRuns', () => {
  test('reads single-line run steps, quoted or not, and skips block scalars and comments', () => {
    const yaml = [
      'steps:',
      '  - run: bun test',
      '  - name: x',
      "    run: 'echo ''hi'''",
      '    run: "a \\"b\\""',
      '    run: |',
      '      multi',
      '    run: make  # trailing',
    ].join('\n');
    expect(workflowRuns(yaml)).toEqual(['bun test', "echo 'hi'", 'a "b"', 'make']);
  });
});

describe('gatesDrift', () => {
  const yaml = '  - run: make check\n';
  test('null when a step runs the gates verbatim', () => expect(gatesDrift(yaml, 'make check')).toBeNull());
  test('reports a drifted step', () => expect(gatesDrift(yaml, 'make check && make lint')).toContain('verbatim'));
  test('reports missing gates', () => expect(gatesDrift(yaml, '')).toContain('no gates'));

  test("this repo's workflow runs exactly the configured gates", () => {
    const gates = JSON.parse(readFileSync(join(REPO, '.claude/workloop.config.json'), 'utf-8')).gates as string;
    expect(gatesDrift(readFileSync(join(REPO, WORKFLOW_PATH), 'utf-8'), gates)).toBeNull();
  });
});

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.md') ? [p] : [];
  });
}

describe('unwaitedMerges', () => {
  test('a merge before any wait is flagged', () => {
    expect(unwaitedMerges('git push\ngh pr merge --squash')).toEqual([2]);
  });
  test('a merge after gh pr checks --watch is fine', () => {
    expect(unwaitedMerges('gh pr checks 3 --watch\ngh pr merge --squash')).toEqual([]);
  });
  test('gh pr checks without --watch does not count as waiting', () => {
    expect(unwaitedMerges('gh pr checks 3\ngh pr merge --squash')).toEqual([2]);
  });
  test('no shipped command, template or pack merges a PR without waiting for its checks', () => {
    const offenders = ['commands', 'templates', 'packs']
      .flatMap(d => files(join(PLUGIN, d)))
      .flatMap(f => unwaitedMerges(readFileSync(f, 'utf-8')).map(line => `${f}:${line}`));
    expect(offenders).toEqual([]);
  });
});
