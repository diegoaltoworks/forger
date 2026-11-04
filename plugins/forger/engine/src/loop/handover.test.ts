import {describe, expect, test} from 'bun:test';

import type {CommandRunner} from '../ports';
import {handedOver, handoverComment, nextMove, openLabel, repeatedCannotTell} from './handover';
import {handOver, handoverCommands} from './handover-io';
import type {Judgement} from './verdict';
import type {VerdictRecord} from './verify-input';

function rec(n: number, verdicts: Judgement[], pr = 7): VerdictRecord {
  const entries = verdicts.map((v, i) => ({criterion: `c${i + 1}`, verdict: v, evidence: []}));
  const decision = verdicts.includes('not_met') ? 'block' : verdicts.includes('cannot_tell') ? 'unclear' : 'pass';
  return {pr, head: `h${n}`, ticket: 'issue-9', verifier: 'm', decision, entries, problems: [], at: `2026-01-0${n}T00:00:00Z`};
}

describe('nextMove', () => {
  const table: Array<[string, VerdictRecord[], 'merge' | 'fix' | 'hand_over']> = [
    ['no record yet', [], 'fix'],
    ['first round passes', [rec(1, ['met'])], 'merge'],
    ['first round blocks', [rec(1, ['met', 'not_met'])], 'fix'],
    ['first round unclear', [rec(1, ['cannot_tell'])], 'fix'],
    ['second round passes', [rec(1, ['not_met']), rec(2, ['met'])], 'merge'],
    ['second round blocks', [rec(1, ['not_met']), rec(2, ['not_met'])], 'hand_over'],
    ['second round unclear', [rec(1, ['not_met']), rec(2, ['cannot_tell'])], 'hand_over'],
  ];
  for (const [name, records, move] of table) {
    test(name, () => expect(nextMove(records, 2).move).toBe(move));
  }

  test('order is by time, not by input order', () => {
    expect(nextMove([rec(2, ['met']), rec(1, ['not_met'])], 2).move).toBe('merge');
  });

  test('a fix names the open criteria and the rounds left', () => {
    expect(nextMove([rec(1, ['met', 'not_met'])], 3)).toEqual({
      move: 'fix', round: 2, remaining: 2, open: [{criterion: 'c2', verdict: 'not_met'}],
    });
  });

  test('a one-round bound hands over at once', () => {
    expect(nextMove([rec(1, ['not_met'])], 1).move).toBe('hand_over');
  });
});

describe('repeatedCannotTell', () => {
  test('lists only criteria unclear in two or more rounds', () => {
    const rs = [rec(1, ['cannot_tell', 'cannot_tell']), rec(2, ['cannot_tell', 'met'])];
    expect(repeatedCannotTell(rs)).toEqual(['c1']);
  });
  test('hand over carries them', () => {
    const m = nextMove([rec(1, ['cannot_tell']), rec(2, ['cannot_tell'])], 2);
    expect(m).toMatchObject({move: 'hand_over', reword: ['c1']});
  });
});

describe('handedOver', () => {
  test('lists spent PRs only, with the criteria at fault', () => {
    const records = [rec(1, ['not_met'], 3), rec(2, ['not_met'], 3), rec(1, ['not_met'], 4), rec(1, ['met'], 5), rec(2, ['met'], 6)];
    const list = handedOver(records, 2);
    expect(list.map(h => h.pr)).toEqual([3]);
    expect(list[0]).toMatchObject({ticket: 'issue-9', rounds: 2, open: [{criterion: 'c1', verdict: 'not_met'}]});
  });
});

describe('handing over', () => {
  const h = handedOver([rec(1, ['not_met', 'cannot_tell']), rec(2, ['met', 'cannot_tell'])], 2)[0];
  const texts = {c1: 'first thing', c2: 'second thing'};

  test('the comment names each open criterion and the ones to reword', () => {
    const c = handoverComment(h, texts);
    expect(c).toContain('- c2 (cannot_tell): second thing');
    expect(c).toContain('reword or make mechanical: c2');
    expect(c).not.toContain('c1 (');
  });

  test('commands label, comment and quote safely', () => {
    const cmds = handoverCommands(9, "it's");
    expect(cmds[0]).toBe('gh issue edit 9 --add-label needs-human');
    expect(cmds[1]).toBe(`gh issue comment 9 --body 'it'\\''s'`);
  });

  test('runs through the runner, labels, comments, leaves the queue', () => {
    const calls: string[] = [];
    const run: CommandRunner = cmd => {
      calls.push(cmd);
      return cmd.includes('--json labels') ? 'needs-human\nready-for-agent\n' : '';
    };
    expect(handOver(run, h, texts, 'ready-for-agent')).toContain('#9');
    expect(calls[0]).toContain('--add-label needs-human');
    expect(calls[1]).toContain('gh issue comment 9');
    expect(calls[calls.length - 1]).toBe(`gh issue edit 9 --remove-label 'ready-for-agent'`);
  });

  test('throws when the label did not land', () => {
    const run: CommandRunner = () => '';
    expect(() => handOver(run, h, texts, 'ready-for-agent')).toThrow(/not labelled/);
  });

  test('a non-issue ticket cannot be handed over', () => {
    expect(() => handOver(() => '', {...h, ticket: 'local-1'}, texts, 'x')).toThrow(/not an issue/);
  });
});

describe('the missing capability', () => {
  const recMissing = (missing?: 'no_test'): VerdictRecord => ({
    pr: 3, head: 'h', ticket: 'issue-3', verifier: 'v', decision: 'unclear', problems: [], at: '2026-01-01T00:00:00Z',
    entries: [{criterion: 'c1', verdict: 'cannot_tell', evidence: [], ...(missing ? {missing} : {})}, {criterion: 'c2', verdict: 'not_met', evidence: []}],
  });

  test('an open cannot_tell carries it into the move, the label and the comment', () => {
    const move = nextMove([recMissing('no_test')], 1);
    if (move.move !== 'hand_over') throw new Error('expected a hand-over');
    expect(move.open.map(openLabel)).toEqual(['c1 cannot_tell (missing: no_test)', 'c2 not_met']);
    const h = handedOver([recMissing('no_test')], 1)[0];
    expect(handoverComment(h, {c1: 'one', c2: 'two'})).toContain('- c1 (cannot_tell, missing no_test): one');
  });

  test('a record from before it was required still reads', () => {
    expect(handedOver([recMissing()], 1)[0].open[0]).toEqual({criterion: 'c1', verdict: 'cannot_tell'});
  });
});
