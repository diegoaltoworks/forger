import {describe, expect, test} from 'bun:test';

import {parseClaim} from './claim';
import {conflictAnswer, conflictHalt, parseConflict} from './conflict';
import {decideOutcome, type RunFacts} from './outcome';

const complete = `constraint: the footer must stay inside the viewport
measured: 18 px of overflow at 320 px width
option: A - shrink the footer text
tradeoff: smaller type than the design rule allows
option: B - wrap the links onto two lines
tradeoff: the footer grows 24 px taller
recommend: B`;

const output = (block: string) => `Built nothing.\n\n<process>stop conflict</process>\n${block}\n`;

const facts: RunFacts = {
  merged: false, pushed: false, branch: null, ticket: 'issue-344', enginePick: 'issue-344', declined: null,
  claim: 'stop', stopReason: 'x', exitCode: 0, signal: null, timedOut: false, timeoutMinutes: 45, baseBranch: 'main',
  backlogCompleted: false, unclean: null, infraError: null, conflict: null, pr: null, verdict: null,
};

function parsed(block: string) {
  const claim = parseClaim(output(block));
  return parseConflict(claim.conflictBlock ?? '');
}

describe('conflict stop', () => {
  test('a complete conflict stop halts with its options and recommendation in the halt message', () => {
    const p = parsed(complete);
    if (!p.ok) throw new Error(p.problems.join('; '));
    const o = decideOutcome({...facts, conflictStop: p.conflict});
    expect(o.status).toBe('halted');
    expect(o.halt).toContain('1. A - shrink the footer text (trade-off: smaller type than the design rule allows)');
    expect(o.halt).toContain('2. B - wrap the links onto two lines');
    expect(o.halt).toContain('Recommendation: B');
    expect(o.halt).toContain('Answer with: decide 344 "<choice>"');
    expect(o.conflictStop).toBeDefined();
  });

  test('a conflict stop with one option is rejected and asked for again', () => {
    const p = parsed(complete.replace(/option: B[^\n]*\ntradeoff: [^\n]*\n/, '').replace('recommend: B', 'recommend: A'));
    expect(p).toEqual({ok: false, problems: ['needs two or three options, got 1']});
  });

  test('a conflict stop that recommends an option it does not list is rejected', () => {
    const p = parsed(complete.replace('recommend: B', 'recommend: C'));
    expect(p).toEqual({ok: false, problems: ['recommend "C" names no listed option']});
  });

  test('a missing field, a gap without a unit and an option without a trade-off are each named', () => {
    const p = parsed('measured: a lot\noption: A\noption: B\ntradeoff: t\nrecommend: A');
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.problems).toEqual(['constraint is missing', 'measured needs a number and a unit', 'option 1 has no tradeoff']);
  });

  test('an incomplete block leaves an ordinary stop', () => {
    const o = decideOutcome({...facts, conflictStop: null});
    expect(o.halt).toBe('x');
    expect(o.conflictStop).toBeUndefined();
  });

  test('the answer line is read back from the halt message', () => {
    const p = parsed(complete);
    if (!p.ok) throw new Error('parse');
    expect(conflictAnswer(conflictHalt(7, p.conflict))).toBe('decide 7 "<choice>"');
    expect(conflictAnswer('Timeout after 45 minutes')).toBeNull();
  });

  test('a plain stop is not a conflict claim', () => {
    expect(parseClaim('<process>stop</process> blocked').conflictBlock).toBeUndefined();
  });
});
