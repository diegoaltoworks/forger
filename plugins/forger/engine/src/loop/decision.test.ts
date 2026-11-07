import {describe, expect, test} from 'bun:test';

import {appendDecision, decisionEntry, haltedOnIssue} from './decision';
import type {TerminalEvent} from './events';

const halt = (ticket: string | null): TerminalEvent => ({event: 'halted', at: 'x', iteration: 1, ticket, reason: 'r'});

describe('decisions', () => {
  test('an entry is dated and attributed, and continuation lines stay inside it', () => {
    expect(decisionEntry(' use A\nnot B ', 'owner', '2030-01-02')).toBe('- 2030-01-02, owner: use A\n  not B');
  });

  test('appends under the existing section, replacing the none placeholder, and leaves later sections alone', () => {
    const body = '## What\n\nx\n\n## Decisions\n\nnone\n\n## Knock-on\n\ny\n';
    const out = appendDecision(body, '- d1');
    expect(out).toBe('## What\n\nx\n\n## Decisions\n\n- d1\n\n## Knock-on\n\ny\n');
    expect(appendDecision(out, '- d2')).toContain('## Decisions\n\n- d1\n- d2\n\n## Knock-on');
  });

  test('creates the section at the end when the ticket has none', () => {
    expect(appendDecision('## What\n\nx\n', '- d1')).toBe('## What\n\nx\n\n## Decisions\n\n- d1\n');
  });

  test('a halt is on an issue only when its ticket is that issue', () => {
    expect(haltedOnIssue(halt('issue-5'), 5)).toBe(true);
    expect(haltedOnIssue(halt('issue-6'), 5)).toBe(false);
    expect(haltedOnIssue(halt(null), 5)).toBe(false);
    expect(haltedOnIssue(null, 5)).toBe(false);
  });
});
