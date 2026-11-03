import {describe, expect, test} from 'bun:test';

import {
  DECLINE_REASONS,
  declineUpdate,
  declinedTickets,
  issueNumber,
  parseDeclineRecord,
  validateDecline,
  type DeclineEntry,
} from './decline';

describe('validateDecline', () => {
  test.each([...DECLINE_REASONS])('accepts the reason %s', reason => {
    expect(validateDecline({ticket: 'issue-4', reason, detail: ' why '})).toEqual({ok: true, ticket: 'issue-4', reason, detail: 'why'});
  });

  test('rejects an unknown reason', () => {
    const r = validateDecline({ticket: 'issue-4', reason: 'tired', detail: 'x'});
    expect(r).toEqual({ok: false, error: '--reason must be one of blocked, too-large, unclear; got "tired"'});
  });

  test('rejects a missing reason, an empty detail and a missing ticket', () => {
    expect(validateDecline({ticket: 'issue-4', detail: 'x'}).ok).toBe(false);
    expect(validateDecline({ticket: 'issue-4', reason: 'blocked', detail: '  '})).toEqual({ok: false, error: '--detail is required: say what the owner must change'});
    expect(validateDecline({reason: 'blocked', detail: 'x'})).toEqual({ok: false, error: '--ticket is required'});
  });
});

describe('issueNumber and parseDeclineRecord', () => {
  test('reads the number of an issue ticket only', () => {
    expect(issueNumber('issue-88')).toBe(88);
    expect(issueNumber('backlog_interface')).toBeNull();
    expect(issueNumber('issue-8x')).toBeNull();
  });

  test('parses a record and refuses anything else', () => {
    const text = JSON.stringify({ticket: 'issue-1', reason: 'unclear', detail: 'd', at: 't'});
    expect(parseDeclineRecord(text)).toEqual({ticket: 'issue-1', reason: 'unclear', detail: 'd', at: 't'});
    expect(parseDeclineRecord('not json')).toBeNull();
    expect(parseDeclineRecord(JSON.stringify({ticket: 'issue-1', reason: 'lazy'}))).toBeNull();
  });
});

const entry = (n: number, reason: DeclineEntry['reason'] = 'blocked'): DeclineEntry => ({ticket: `issue-${n}`, reason, iteration: n});

describe('declineUpdate', () => {
  test('two declines in a row do not halt', () => {
    const one = declineUpdate([], 0, entry(1), 3);
    const two = declineUpdate(one.declined_tasks, one.consecutive_declines, entry(2), 3);
    expect(two.consecutive_declines).toBe(2);
    expect(two.halt).toBeNull();
  });

  test('three in a row halt and name each ticket with its reason', () => {
    const history = [entry(1), entry(2, 'too-large')];
    const three = declineUpdate(history, 2, entry(3, 'unclear'), 3);
    expect(three.consecutive_declines).toBe(3);
    expect(three.halt).toContain('Declined 3 tickets in a row: issue-1 (blocked), issue-2 (too-large), issue-3 (unclear).');
  });

  test('any other outcome ends the run but keeps the history', () => {
    const r = declineUpdate([entry(1), entry(2)], 2, null, 3);
    expect(r).toEqual({declined_tasks: [entry(1), entry(2)], consecutive_declines: 0, halt: null});
  });

  test('only the current run is named in the halt', () => {
    const r = declineUpdate([entry(1), entry(2)], 0, entry(3), 1);
    expect(r.halt).toContain('issue-3 (blocked)');
    expect(r.halt).not.toContain('issue-1');
  });
});

test('declinedTickets lists each ticket once with its latest reason', () => {
  expect(declinedTickets([entry(1), entry(2), entry(1, 'unclear')])).toEqual([
    {ticket: 'issue-1', reason: 'unclear'},
    {ticket: 'issue-2', reason: 'blocked'},
  ]);
});
