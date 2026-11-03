import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'fs';
import {join} from 'path';

import {SpecOutputError, type CapturingRunner, type CommandResult} from '../ports';
import {slcrProvider} from './slcr';
import {buildReport, parseCheckSpecs, parseModalities, toModality} from './slcr-report';

const fixture = (name: string) => readFileSync(join(import.meta.dir, 'fixtures', 'slcr', name), 'utf-8');
const ok = (stdout: string): CommandResult => ({stdout, stderr: '', exitCode: 0});

describe('parseCheckSpecs', () => {
  test('reads each requirement state per spec file from recorded output', () => {
    const specs = parseCheckSpecs(fixture('check.json'));
    expect(specs).toHaveLength(1);
    expect(specs[0].file).toBe('SPEC.slcr.yml');
    expect(specs[0].requirements.map(r => `${r.id}:${r.state}`)).toEqual([
      'REQ-001:unsatisfied', 'REQ-002:unsatisfied', 'REQ-003:satisfied', 'REQ-004:satisfied', 'REQ-005:unsatisfied', 'REQ-006:satisfied', 'REQ-007:satisfied',
    ]);
  });

  test('a project that does not vet names vet.passed', () => {
    expect(() => parseCheckSpecs(fixture('check-vet-failed.json'))).toThrow(/vet\.passed/);
  });

  test.each([
    ['not json', /not JSON/],
    ['[]', /slcr check is missing or not an object/],
    ['{"passed":true}', /specs is missing/],
    ['{"specs":{}}', /specs is missing or not an array/],
    ['{"specs":[{"requirements":[]}]}', /specs\[0\]\.file/],
    ['{"specs":[{"file":"a","requirements":{}}]}', /specs\[0\]\.requirements/],
    ['{"specs":[{"file":"a","requirements":[{"id":"R"}]}]}', /specs\[0\]\.requirements\[0\]\.status/],
    ['{"specs":[{"file":"a","requirements":[{"id":"R","status":"green"}]}]}', /status is not satisfied/],
    ['{"specs":[{"file":"a","requirements":[{"status":"unknown"}]}]}', /requirements\[0\]\.id/],
  ])('a changed shape is an error naming the field: %s', (text, field) => {
    expect(() => parseCheckSpecs(text)).toThrow(SpecOutputError);
    expect(() => parseCheckSpecs(text)).toThrow(field);
  });
});

describe('parseModalities', () => {
  test('reads id and modality from recorded output, folding the negated forms', () => {
    const m = parseModalities(fixture('query-modality.json'));
    expect(m.get('REQ-003')).toBe('SHOULD');
    expect(m.get('REQ-006')).toBe('MUST');
    expect(m.get('REQ-004')).toBe('MAY');
  });

  test.each([
    ['{"columns":["a","b"],"rows":[]}', /columns/],
    ['{"columns":["r.id","r.modality"]}', /rows/],
    ['{"columns":["r.id","r.modality"],"rows":[["R",null]]}', /rows\[0\]\[1\]/],
    ['{"columns":["r.id","r.modality"],"rows":[["R","MAYBE"]]}', /not a known modality/],
  ])('a changed shape is an error naming the field: %s', (text, field) => {
    expect(() => parseModalities(text)).toThrow(field);
  });

  test('toModality', () => expect(toModality('SHOULD NOT', 'x')).toBe('SHOULD'));
});

describe('buildReport', () => {
  const spec = {file: 'S.toml', requirements: [{id: 'A', state: 'satisfied' as const}]};
  test('a requirement without a modality is refused', () => {
    expect(() => buildReport([{spec, modalities: new Map()}])).toThrow(/A of S\.toml has no modality/);
  });
  test('the same id in two specs is refused', () => {
    const m = new Map([['A', 'MUST' as const]]);
    expect(() => buildReport([{spec, modalities: m}, {spec, modalities: m}])).toThrow(/more than one spec/);
  });
});

describe('slcrProvider', () => {
  function runner(calls: string[], overrides: Record<string, CommandResult> = {}): (cwd: string) => CapturingRunner {
    return cwd => cmd => {
      calls.push(`${cwd}$ ${cmd}`);
      for (const [needle, result] of Object.entries(overrides)) if (cmd.includes(needle)) return result;
      if (cmd.startsWith('slcr check')) return ok(fixture('check.json'));
      if (cmd.startsWith('slcr query')) return ok(fixture('query-modality.json'));
      if (cmd.startsWith('slcr slice')) return ok(fixture('slice.txt'));
      return ok('');
    };
  }
  const scratch = (log: string[]) => ({make: () => '/scratch', remove: (d: string) => void log.push(`rm ${d}`)});

  test('the head report joins states and modalities, run in the project root', () => {
    const calls: string[] = [];
    const provider = slcrProvider({projectRoot: '/p', baseBranch: 'main', runIn: runner(calls)});
    const report = provider.report('head');
    expect(report?.requirements.find(r => r.id === 'REQ-001')).toEqual({id: 'REQ-001', modality: 'MUST', state: 'unsatisfied'});
    expect(report?.requirements.find(r => r.id === 'REQ-003')).toEqual({id: 'REQ-003', modality: 'SHOULD', state: 'satisfied'});
    expect(calls[0]).toBe('/p$ slcr check --format json');
    expect(calls[1]).toBe(`/p$ slcr query 'MATCH (r:Requirement) RETURN r.id, r.modality' 'SPEC.slcr.yml' --format json`);
  });

  test('a failing check still carries a report (slcr exits 1 on an unsatisfied MUST)', () => {
    const provider = slcrProvider({projectRoot: '/p', baseBranch: 'main', runIn: runner([], {'slcr check': {stdout: fixture('check.json'), stderr: 'Error', exitCode: 1}})});
    expect(provider.report('head')?.requirements).toHaveLength(7);
  });

  test('no binary is an absent report and slice', () => {
    const gone: CommandResult = {stdout: '', stderr: 'slcr: not found', exitCode: 127};
    const provider = slcrProvider({projectRoot: '/p', baseBranch: 'main', runIn: runner([], {slcr: gone})});
    expect(provider.report('head')).toBeNull();
    expect(provider.slice('REQ-1')).toBeNull();
  });

  test('a side with no SLCR.toml is an absent report', () => {
    const none: CommandResult = {stdout: '', stderr: 'Error:   x could not find SLCR.toml in the working directory', exitCode: 1};
    const provider = slcrProvider({projectRoot: '/p', baseBranch: 'main', runIn: runner([], {'slcr check': none})});
    expect(provider.report('head')).toBeNull();
  });

  test('a failed query is an error naming the spec', () => {
    const bad: CommandResult = {stdout: '', stderr: 'boom', exitCode: 2};
    const provider = slcrProvider({projectRoot: '/p', baseBranch: 'main', runIn: runner([], {'slcr query': bad})});
    expect(() => provider.report('head')).toThrow(/slcr query failed for SPEC\.slcr\.yml/);
  });

  test('the base report runs in a scratch export that is removed', () => {
    const calls: string[] = [];
    const log: string[] = [];
    const provider = slcrProvider({projectRoot: '/p', baseBranch: 'main', runIn: runner(calls), scratch: scratch(log)});
    const exported: string[] = [];
    const withBase = slcrProvider({projectRoot: '/p', baseBranch: 'main', runIn: runner(calls), scratch: scratch(log), exportBase: dir => !!exported.push(dir)});
    expect(withBase.report('base')?.requirements).toHaveLength(7);
    expect(calls[0]).toBe('/scratch$ slcr check --format json');
    expect(exported).toEqual(['/scratch']);
    const noBase = slcrProvider({projectRoot: '/p', baseBranch: 'gone', runIn: runner(calls), scratch: scratch(log), exportBase: () => false});
    expect(noBase.report('base')).toBeNull();
    expect(log).toEqual(['rm /scratch', 'rm /scratch']);
    expect(provider).toBeDefined();
  });

  test('slice returns the text, and a failure names the id', () => {
    const provider = slcrProvider({projectRoot: '/p', baseBranch: 'main', runIn: runner([])});
    expect(provider.slice('REQ-005')).toContain('There MUST be a controller for TodoListItem.');
    const bad = slcrProvider({projectRoot: '/p', baseBranch: 'main', runIn: runner([], {'slcr slice': {stdout: '', stderr: 'has no requirement REQ-099', exitCode: 1}})});
    expect(() => bad.slice('REQ-099')).toThrow(/slcr slice REQ-099 failed/);
  });
});
