import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'fs';
import {join} from 'path';

import {parseCriteria, parseUiStates} from './verdict';
import {recordVerdict} from './verify-input';

const fixture = (name: string, file: string) => readFileSync(join(import.meta.dir, 'fixtures/verifier-eval', name, file), 'utf-8');
const subject = {pr: 1, head: 'h', ticket: 'issue-1', verifier: 'v', at: 'now'};

describe('verifier eval: screenshots against UI states', () => {
  test('a PR with a visibly wrong empty state is blocked', () => {
    const issue = fixture('empty-state-banner', 'issue.md');
    const criteria = [...parseCriteria(issue), ...parseUiStates(issue)];
    const record = recordVerdict(subject, criteria, fixture('empty-state-banner', 'reply.json'), () => true);
    expect(record.problems).toEqual([]);
    expect(record.entries.find(e => e.criterion === 'u1')?.verdict).toBe('not_met');
    expect(record.decision).toBe('block');
  });

  test('the same reply without a resolving screenshot cannot pass a state as met', () => {
    const issue = fixture('empty-state-banner', 'issue.md');
    const criteria = [...parseCriteria(issue), ...parseUiStates(issue)];
    const record = recordVerdict(subject, criteria, fixture('empty-state-banner', 'reply.json'), e => e.kind !== 'screenshot');
    expect(record.entries.find(e => e.criterion === 'u2')?.verdict).toBe('cannot_tell');
  });
});
