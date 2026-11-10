import {afterEach, describe, expect, test} from 'bun:test';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {buildReport} from '../checks';
import {appendCheckRecords} from './append';
import {recordsFromReport} from './from-report';

const ctx = {at: '2000-01-01T00:00:00.000Z', ticket: 'issue-7', iteration: 3};
const f = (opinion: string, file = 'a.ts') => ({file, line: 1, opinion, rule: 'r', detail: 'd'});
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'forger-record-'));
  dirs.push(d);
  return d;
};

describe('recordsFromReport', () => {
  test('a report with two failed opinions yields one record for each, with its count', () => {
    const report = buildReport([{check: 'docs', findings: [f('x'), f('x', 'b.ts'), f('y')]}], []);
    expect(recordsFromReport(report, ctx)).toEqual([
      {...ctx, opinion: 'x', check: 'docs', failed: 2, waived: 0},
      {...ctx, opinion: 'y', check: 'docs', failed: 1, waived: 0},
    ]);
  });

  test('a waived finding is counted as waived and not as failed', () => {
    const waiver = {opinion: 'x', path: 'a.ts', reason: 'r', approved_by: 'o'};
    const report = buildReport([{check: 'docs', findings: [f('x')]}], [waiver as never]);
    expect(recordsFromReport(report, ctx)).toEqual([{...ctx, opinion: 'x', check: 'docs', failed: 0, waived: 1}]);
  });

  test('a report with no finding yields one record with no opinion', () => {
    const records = recordsFromReport(buildReport([{check: 'docs', findings: []}], []), ctx);
    expect(records).toEqual([{...ctx, failed: 0, waived: 0, clean: true}]);
    expect(records[0].opinion).toBeUndefined();
  });
});

describe('appendCheckRecords', () => {
  const report = buildReport([{check: 'docs', findings: [f('x')]}], []);

  test('check appends records when FORGER_TICKET is set and writes nothing when it is not', () => {
    const root = tmp();
    const env = {ticket: 'issue-7', iteration: 3};
    expect(appendCheckRecords(report, null, root, '.forger/checks.jsonl')).toBeNull();
    expect(existsSync(join(root, '.forger/checks.jsonl'))).toBe(false);
    expect(appendCheckRecords(report, env, root, '.forger/checks.jsonl')).toBeNull();
    expect(appendCheckRecords(report, env, root, '.forger/checks.jsonl')).toBeNull();
    const lines = readFileSync(join(root, '.forger/checks.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ticket: 'issue-7', iteration: 3, opinion: 'x', check: 'docs', failed: 1, waived: 0});
  });

  test('a record that cannot be written leaves the exit code of check unchanged', () => {
    const root = tmp();
    writeFileSync(join(root, 'blocker'), '');
    const warning = appendCheckRecords(report, {ticket: 'issue-7', iteration: 0}, join(root, 'blocker'), '.forger/checks.jsonl');
    expect(warning).toStartWith('warning: could not record');
    expect(process.exitCode ?? 0).toBe(0);
  });
});
