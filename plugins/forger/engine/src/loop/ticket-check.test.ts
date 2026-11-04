import {describe, expect, test} from 'bun:test';

import {refuseUncheckable} from './ticket-check';

const target = {trackerKind: 'github' as const, intakeLabel: 'ready-for-agent', backlogFile: '/none'};

/** A tracker that answers the label reads the relabel check makes. */
function fakeTracker() {
  const commands: string[] = [];
  const run = (cmd: string): string => {
    commands.push(cmd);
    return cmd.includes('--json labels') ? 'needs-info\n' : '';
  };
  return {run, commands};
}

describe('refuseUncheckable', () => {
  test('relabels a failing ticket needs-info and names the criteria; leaves a passing one', () => {
    const t = fakeTracker();
    const out = refuseUncheckable(
      t.run,
      target,
      [
        {id: 'issue-1', body: '## Acceptance\n- [ ] Relief sharpens'},
        {id: 'issue-2', body: '## Acceptance\n- [ ] Gates green'},
        {id: 'issue-3', body: null},
      ],
      {}
    );
    expect(out.refused.map(r => r.ticket)).toEqual(['issue-1']);
    expect(t.commands.some(c => c.includes('gh issue edit 1') && c.includes('--add-label needs-info'))).toBe(true);
    expect(t.commands.some(c => c.includes('gh issue comment 1') && c.includes('Relief sharpens'))).toBe(true);
    expect(t.commands.some(c => c.includes('issue edit 2') || c.includes('comment 2'))).toBe(false);
  });

  test('a tracker failure leaves the ticket queued and is reported', () => {
    const out = refuseUncheckable(() => { throw new Error('gh down'); }, target, [{id: 'issue-1', body: '## Acceptance\n- [ ] nice'}], {});
    expect(out.refused).toEqual([]);
    expect(out.errors[0]).toContain('issue-1');
  });
});
