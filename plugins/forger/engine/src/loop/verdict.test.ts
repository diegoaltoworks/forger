import {describe, expect, test} from 'bun:test';

import {checkVerdict, parseCriteria, parseUiStates, reduceVerdict, type Criterion, type Evidence, type VerdictEntry} from './verdict';

const criteria: Criterion[] = [
  {id: 'c1', text: 'one'},
  {id: 'c2', text: 'two'},
];
const good: Evidence = {kind: 'test', ref: 'real'};
const bad: Evidence = {kind: 'file', ref: 'ghost.ts:1'};
const resolves = (e: Evidence) => e.ref === 'real';
const e = (criterion: string, verdict: VerdictEntry['verdict'], evidence: Evidence[] = [good]): VerdictEntry => ({
  criterion,
  verdict,
  evidence,
});

describe('parseCriteria', () => {
  test.each([
    ['acceptance section only', '## What\n- [ ] not me\n## Acceptance\n- [ ] a\n- [x] b\n* [X] c\n## Knock-on\n- [ ] no', ['a', 'b', 'c']],
    ['no acceptance heading: every checkbox', '- [ ] a\ntext\n- [ ] b', ['a', 'b']],
    ['plain bullets are not criteria', '## Acceptance\n- plain\n- [ ] only', ['only']],
    ['no checkboxes', '## Acceptance\nnothing', []],
    ['CRLF', '## Acceptance\r\n- [ ] a\r\n', ['a']],
  ])('%s', (_name, body, texts) => {
    expect(parseCriteria(body).map(c => c.text)).toEqual(texts);
  });

  test('ids follow order', () => {
    expect(parseCriteria('## Acceptance\n- [ ] a\n- [ ] b').map(c => c.id)).toEqual(['c1', 'c2']);
  });
});

describe('checkVerdict and reduceVerdict', () => {
  const run = (v: VerdictEntry[]) => {
    const r = checkVerdict(criteria, v, resolves);
    return {...r, decision: reduceVerdict(r.entries)};
  };

  test('all met passes', () => {
    const r = run([e('c1', 'met'), e('c2', 'met')]);
    expect(r.problems).toEqual([]);
    expect(r.decision).toBe('pass');
  });

  test('missing criterion is rejected', () => {
    const r = run([e('c1', 'met')]);
    expect(r.problems).toEqual(['missing criterion c2: two']);
  });

  test('extra criterion is rejected', () => {
    const r = run([e('c1', 'met'), e('c2', 'met'), e('c9', 'met')]);
    expect(r.problems.join()).toContain('extra criterion c9');
    expect(r.entries.map(x => x.criterion)).toEqual(['c1', 'c2']);
  });

  test('duplicate criterion is rejected', () => {
    expect(run([e('c1', 'met'), e('c1', 'met'), e('c2', 'met')]).problems.join()).toContain('more than once');
  });

  test('met without evidence is rejected', () => {
    expect(run([e('c1', 'met', []), e('c2', 'met')]).problems.join()).toContain('c1 is met without evidence');
  });

  test('not_met without evidence is rejected', () => {
    expect(run([e('c1', 'not_met', []), e('c2', 'met')]).problems.join()).toContain('not_met without evidence');
  });

  test('met with unresolvable evidence is demoted, not rejected', () => {
    const r = run([e('c1', 'met', [bad]), e('c2', 'met')]);
    expect(r.problems).toEqual([]);
    expect(r.entries[0].verdict).toBe('cannot_tell');
    expect(r.entries[0].demoted).toBeDefined();
    expect(r.decision).toBe('unclear');
  });

  test('not_met with unresolvable evidence is rejected', () => {
    expect(run([e('c1', 'not_met', [bad]), e('c2', 'met')]).problems.join()).toContain('no evidence reference resolves');
  });

  test('one resolvable reference is enough', () => {
    expect(run([e('c1', 'met', [bad, good]), e('c2', 'met')]).entries[0].verdict).toBe('met');
  });

  test('one not met blocks, even beside a cannot_tell', () => {
    const r = run([e('c1', 'not_met'), e('c2', 'cannot_tell', [])]);
    expect(r.problems).toEqual([]);
    expect(r.decision).toBe('block');
  });

  test('one cannot tell is unclear', () => {
    expect(run([e('c1', 'met'), e('c2', 'cannot_tell', [])]).decision).toBe('unclear');
  });

  test('unknown verdict value is rejected', () => {
    const odd = {criterion: 'c1', verdict: 'maybe', evidence: [good]} as unknown as VerdictEntry;
    expect(run([odd, e('c2', 'met')]).problems.join()).toContain('unknown verdict');
  });

  test('entries come back in criterion order', () => {
    expect(run([e('c2', 'met'), e('c1', 'met')]).entries.map(x => x.criterion)).toEqual(['c1', 'c2']);
  });
});

describe('UI states', () => {
  const body = '## Acceptance\n- [ ] a\n\n## UI states\n- empty: no banner\n- [ ] filled: listed\n\n## Docs\n- not a state\n';
  const states = parseUiStates(body);
  const seen = (e: {kind: string; ref: string}) => e.ref.length > 0;

  test('parses the bullets of the UI states section only; "none" names no state', () => {
    expect(states).toEqual([
      {id: 'u1', text: 'empty: no banner', ui: true},
      {id: 'u2', text: 'filled: listed', ui: true},
    ]);
    expect(parseUiStates('## UI states\nnone\n- none\n')).toEqual([]);
    expect(parseUiStates('## Acceptance\n- [ ] a\n')).toEqual([]);
  });

  test('met on a UI state without a screenshot is demoted to cannot_tell', () => {
    const r = checkVerdict(states, [
      {criterion: 'u1', verdict: 'met', evidence: [{kind: 'file', ref: 'src/a.ts'}]},
      {criterion: 'u2', verdict: 'met', evidence: [{kind: 'screenshot', ref: 'docs/screenshots/a.png'}]},
    ], seen);
    expect(r.problems).toEqual([]);
    expect(r.entries.map(e => e.verdict)).toEqual(['cannot_tell', 'met']);
    expect(r.entries[0].demoted).toContain('screenshot');
  });

  test('not_met on a screenshot blocks', () => {
    const r = checkVerdict(states, [
      {criterion: 'u1', verdict: 'not_met', evidence: [{kind: 'screenshot', ref: 'docs/screenshots/a.png'}]},
      {criterion: 'u2', verdict: 'cannot_tell', evidence: []},
    ], seen);
    expect(reduceVerdict(r.entries)).toBe('block');
  });
});
