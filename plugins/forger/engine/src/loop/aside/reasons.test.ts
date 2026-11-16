import {describe, expect, test} from 'bun:test';

import {terminalEvent} from '../events';
import {githubCommand} from '../../tracker';
import {answerCommands, reasonSummary, setAsideComment, setAsideReasons} from './reasons';

describe('setAsideReasons', () => {
  test('the latest reason per issue, from set_aside events only', () => {
    const events = [
      terminalEvent('set_aside', 1, 'issue-7', 'first'),
      terminalEvent('halted', 2, 'issue-8', 'not an aside'),
      terminalEvent('set_aside', 3, 'issue-7', 'second'),
      terminalEvent('set_aside', 4, 'not-an-issue', 'no number'),
    ];
    expect([...setAsideReasons(events)]).toEqual([[7, 'second']]);
  });

  test('an event with no reason still names the issue', () => {
    expect(setAsideReasons([terminalEvent('set_aside', 1, 'issue-3', null)]).get(3)).toBe('no reason recorded');
  });
});

describe('answering a ticket set aside', () => {
  test('removes needs-human and restores the intake label', () => {
    expect(answerCommands(7, 'ready-for-agent').map(githubCommand)).toEqual(["gh issue edit 7 --remove-label 'needs-human'", "gh issue edit 7 --add-label 'ready-for-agent'"]);
  });
  test("the owner's answer is two writes: needs-human removed and the intake label added", () => {
    expect(answerCommands(7, 'ready-for-agent')).toEqual([
      {kind: 'labels', ticket: 7, add: [], remove: ['needs-human']},
      {kind: 'labels', ticket: 7, add: ['ready-for-agent'], remove: []},
    ]);
  });
  test('the comment carries the reason and the answer line', () => {
    const c = setAsideComment(7, 'needs a key');
    expect(c).toContain('Reason: needs a key');
    expect(c).toContain('Answer with: decide 7 "<choice>"');
  });
  test('a summary is the first non-empty line', () => {
    expect(reasonSummary('\nfirst line\nsecond')).toBe('first line');
  });
});
