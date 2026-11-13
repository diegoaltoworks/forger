import {describe, expect, test} from 'bun:test';

import {DEFAULT_CONFIG} from '../config';
import {buildVerifierInput, extractVerdict, recordVerdict, verifierTier} from './verify-input';

const criteria = [
  {id: 'c1', text: 'refuses on a failed check'},
  {id: 'c2', text: 'record names the head'},
];
const subject = {pr: 7, head: 'abc123', ticket: 'issue-1', verifier: 'opus', at: 'now'};
const resolves = (e: {ref: string}) => e.ref === 'real';

describe('buildVerifierInput', () => {
  const text = buildVerifierInput({criteria, diff: 'diff --git a/x b/x\n+added line', gate: {checks: 'failure', failing_checks: ['gates']}});

  test('holds the criteria, the diff and the gate result', () => {
    expect(text).toContain('c1: refuses on a failed check');
    expect(text).toContain('c2: record names the head');
    expect(text).toContain('+added line');
    expect(text).toContain('failure (gates)');
  });

  test('states the form a test reference takes', () => {
    expect(text).toContain('"describe > test" for a test inside a describe');
  });

  test('has no way to carry the PR body, the commit messages or a transcript', () => {
    expect(buildVerifierInput.length).toBe(1);
    expect(text).not.toContain('Closes #');
  });
});

describe('verifierTier', () => {
  test('the configured tier wins', () => {
    const t = {model: 'fast', budget: 1};
    expect(verifierTier({...DEFAULT_CONFIG, verifier: t})).toBe(t);
  });

  test('defaults to a tier other than the default worker tier', () => {
    expect(verifierTier(DEFAULT_CONFIG).model).toBe('deep');
  });

  test('falls back to the worker tier when the config has no other', () => {
    const only = {...DEFAULT_CONFIG, model_by_priority: {P0: DEFAULT_CONFIG.model_by_priority.default, default: DEFAULT_CONFIG.model_by_priority.default}};
    expect(verifierTier(only).model).toBe('standard');
  });
});

describe('extractVerdict', () => {
  const body = '{"verdict":[{"criterion":"c1","verdict":"met","evidence":[]}]}';
  test.each([
    ['bare', body],
    ['fenced', `Here you go:\n\`\`\`json\n${body}\n\`\`\`\nDone`],
    ['surrounded', `thinking... ${body} bye`],
  ])('%s', (_n, out) => {
    expect(extractVerdict(out)?.[0].criterion).toBe('c1');
  });
  test('garbage is null', () => {
    expect(extractVerdict('no json here')).toBeNull();
    expect(extractVerdict('{"other":1}')).toBeNull();
  });
});

describe('recordVerdict', () => {
  const ev = [{kind: 'test', ref: 'real'}];
  test('valid output is recorded as judged, with the head', () => {
    const out = JSON.stringify({verdict: [{criterion: 'c1', verdict: 'met', evidence: ev}, {criterion: 'c2', verdict: 'cannot_tell', missing: 'no_data', evidence: []}]});
    const r = recordVerdict(subject, criteria, out, resolves);
    expect(r.head).toBe('abc123');
    expect(r.pr).toBe(7);
    expect(r.decision).toBe('unclear');
    expect(r.entries.map(e => e.verdict)).toEqual(['met', 'cannot_tell']);
    expect(r.problems).toEqual([]);
  });

  test('all met passes', () => {
    const out = JSON.stringify({verdict: criteria.map(c => ({criterion: c.id, verdict: 'met', evidence: ev}))});
    expect(recordVerdict(subject, criteria, out, resolves).decision).toBe('pass');
  });

  test.each([
    ['unparseable', 'I think it is fine'],
    ['a criterion missing', JSON.stringify({verdict: [{criterion: 'c1', verdict: 'met', evidence: [{kind: 'test', ref: 'real'}]}]})],
    ['an extra criterion', JSON.stringify({verdict: [{criterion: 'c1', verdict: 'met', evidence: [{kind: 'test', ref: 'real'}]}, {criterion: 'c2', verdict: 'met', evidence: [{kind: 'test', ref: 'real'}]}, {criterion: 'c9', verdict: 'met', evidence: []}]})],
  ])('%s is recorded cannot_tell for every criterion', (_n, out) => {
    const r = recordVerdict(subject, criteria, out, resolves);
    expect(r.entries.map(e => [e.criterion, e.verdict])).toEqual([['c1', 'cannot_tell'], ['c2', 'cannot_tell']]);
    expect(r.decision).toBe('unclear');
    expect(r.problems.length).toBeGreaterThan(0);
  });
});

describe('buildVerifierInput setup', () => {
  const base = {criteria, diff: 'd', gate: {checks: 'success' as const, failing_checks: []}};

  test("the verifier's prompt says no setup ran when the copy has none", () => {
    const text = buildVerifierInput(base);
    expect(text).toContain('No setup ran');
    expect(text).toContain('missing "infra", never "not_met"');
    expect(text).not.toContain('with its dependencies installed');
  });

  test("the verifier's prompt says dependencies are installed when a setup ran", () => {
    const text = buildVerifierInput({...base, setupRan: true});
    expect(text).toContain('with its dependencies installed');
    expect(text).not.toContain('No setup ran');
  });
});
