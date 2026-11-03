import {describe, expect, test} from 'bun:test';

import {type Outcome, type RunFacts, decideOutcome} from './outcome';
import type {PrFact} from './pr-checks';

const nothing: RunFacts = {
  merged: false,
  pushed: false,
  branch: null,
  ticket: 'the_ticket',
  enginePick: 'the_ticket',
  declined: null,
  claim: null,
  stopReason: null,
  exitCode: 0,
  signal: null,
  timedOut: false,
  timeoutMinutes: 45,
  baseBranch: 'main',
  backlogCompleted: false,
  unclean: null,
  infraError: null,
  pr: null,
  verdict: 'pass',
};

function pr(checks: PrFact['checks'], failing: string[] = []): PrFact {
  return {number: 75, state: 'MERGED', merged: true, checks, checks_ok: checks === 'success' || checks === 'none', failing_checks: failing, head: 'h1'};
}

describe('decideOutcome on the PR checks of a merge', () => {
  const cases: {name: string; facts: Partial<RunFacts>; status: Outcome['status']; result: Outcome['result']; halt: string | null}[] = [
    {name: 'merged green', facts: {merged: true, pr: pr('success')}, status: 'completed', result: 'success', halt: null},
    {name: 'merged on a repo without CI', facts: {merged: true, pr: pr('none')}, status: 'completed', result: 'success', halt: null},
    {
      name: 'merged red',
      facts: {merged: true, pr: pr('failure', ['gates'])},
      status: 'merged-red',
      result: 'failure',
      halt: 'PR #75 merged into main with failing check: gates. main may be red; fix it before more work lands.',
    },
    {
      name: 'merged pending',
      facts: {merged: true, pr: pr('pending')},
      status: 'merged-red',
      result: 'failure',
      halt: 'PR #75 merged into main with checks still pending. main may be red; fix it before more work lands.',
    },
    {
      name: 'not merged, checks failing',
      facts: {merged: false, pr: {...pr('failure', ['gates']), state: 'OPEN', merged: false}},
      status: 'failed',
      result: 'failure',
      halt: null,
    },
  ];
  for (const c of cases) {
    test(c.name, () => {
      const o = decideOutcome({...nothing, claim: 'complete', backlogCompleted: false, ...c.facts});
      expect(o.status).toBe(c.status);
      expect(o.result).toBe(c.result);
      expect(o.halt).toBe(c.halt);
    });
  }

  test('a red merge is recorded as merged_red and names every failing check', () => {
    const o = decideOutcome({...nothing, merged: true, claim: 'complete', backlogCompleted: true, pr: pr('failure', ['gates', 'lint'])});
    expect(o.merged).toBe(true);
    expect(o.haltKind).toBe('merged_red');
    expect(o.error).toContain('failing checks: gates, lint');
  });
});

describe('decideOutcome', () => {
  test('merged with a completion claim is a success', () => {
    const o = decideOutcome({...nothing, merged: true, claim: 'complete', backlogCompleted: true});
    expect(o).toEqual({
      status: 'completed',
      result: 'success',
      merged: true,
      error: null,
      warning: null,
      halt: null,
    });
  });

  test('merged then timed out is a success, not a failure', () => {
    const o = decideOutcome({
      ...nothing,
      merged: true,
      timedOut: true,
      exitCode: 1,
      signal: 'SIGKILL',
      branch: 'feat/the_ticket',
      unclean: 'HEAD is on "feat/the_ticket", not main',
    });
    expect(o.result).toBe('success');
    expect(o.status).toBe('completed');
    expect(o.error).toBeNull();
    expect(o.warning).toBe('merged, then timed out; HEAD is on "feat/the_ticket", not main');
  });

  test('merged without any claim is still a success', () => {
    const o = decideOutcome({...nothing, merged: true, exitCode: 1});
    expect(o.result).toBe('success');
    expect(o.warning).toBeNull();
  });

  test('merged then stop is a success that also halts', () => {
    const o = decideOutcome({...nothing, merged: true, claim: 'stop', stopReason: 'needs a key'});
    expect(o.result).toBe('success');
    expect(o.halt).toBe('needs a key');
  });

  test('stop without a merge halts and counts neither way', () => {
    const o = decideOutcome({...nothing, claim: 'stop', stopReason: 'no actionable work'});
    expect(o.result).toBe('neutral');
    expect(o.merged).toBe(false);
    expect(o.halt).toBe('no actionable work');
  });

  test('backlog reads completed but nothing merged: reported, halts, not progress', () => {
    const o = decideOutcome({
      ...nothing,
      claim: 'complete',
      backlogCompleted: true,
      branch: 'feat/the_ticket',
      pushed: true,
    });
    expect(o.result).toBe('failure');
    expect(o.merged).toBe(false);
    expect(o.status).toBe('failed');
    expect(o.halt).toContain('"the_ticket" reads completed in the backlog but nothing merged');
    expect(o.halt).toContain('feat/the_ticket is pushed');
    expect(o.error).toBe(o.halt);
  });

  test('backlog divergence is reported even when the worker asked to stop', () => {
    const o = decideOutcome({...nothing, claim: 'stop', stopReason: 'x', backlogCompleted: true});
    expect(o.result).toBe('failure');
    expect(o.halt).toContain('reads completed in the backlog');
  });

  test('backlog divergence with an unpushed branch says so', () => {
    const o = decideOutcome({...nothing, backlogCompleted: true, branch: 'feat/the_ticket'});
    expect(o.halt).toContain('feat/the_ticket is not pushed');
  });

  test('timed out with nothing merged or pushed', () => {
    const o = decideOutcome({...nothing, timedOut: true, exitCode: 1, signal: 'SIGKILL'});
    expect(o).toEqual({
      status: 'timeout',
      result: 'failure',
      merged: false,
      error: 'Timeout after 45 minutes, ended by SIGKILL',
      warning: null,
      halt: null,
    });
  });

  test('timed out with the branch pushed names the branch', () => {
    const o = decideOutcome({
      ...nothing,
      timedOut: true,
      branch: 'feat/the_ticket',
      pushed: true,
    });
    expect(o.status).toBe('timeout');
    expect(o.error).toBe('Timeout after 45 minutes; feat/the_ticket pushed, not merged');
  });

  test('claimed complete with nothing merged is a failure', () => {
    const o = decideOutcome({...nothing, claim: 'complete'});
    expect(o.status).toBe('failed');
    expect(o.result).toBe('failure');
    expect(o.error).toBe('Claimed complete but nothing merged into main');
  });

  test('pushed but not merged is partial and a failure', () => {
    const o = decideOutcome({...nothing, branch: 'feat/the_ticket', pushed: true});
    expect(o.status).toBe('partial');
    expect(o.result).toBe('failure');
    expect(o.error).toBe('feat/the_ticket pushed, not merged');
  });

  test('nothing merged or pushed is a failure with the exit code', () => {
    const o = decideOutcome({...nothing, exitCode: 2});
    expect(o.status).toBe('failed');
    expect(o.result).toBe('failure');
    expect(o.error).toBe('Nothing merged or pushed, exit code 2');
  });

  test('an infrastructure error halts with its reason and is not a failure', () => {
    const o = decideOutcome({...nothing, exitCode: 1, infraError: 'Infrastructure error (billing)'});
    expect(o.result).toBe('neutral');
    expect(o.status).toBe('error');
    expect(o.halt).toBe('Infrastructure error (billing)');
    expect(o.merged).toBe(false);
  });

  test('a merge outranks an infrastructure error', () => {
    const o = decideOutcome({...nothing, merged: true, infraError: 'Infrastructure error (network)'});
    expect(o.result).toBe('success');
    expect(o.halt).toBeNull();
  });
});

describe('decideOutcome on the engine pick (ADR 0008 table)', () => {
  const merged = {merged: true, pushed: true, branch: 'feat/the_ticket', claim: 'complete' as const, pr: pr('success')};
  const rows: {name: string; facts: Partial<RunFacts>; status: Outcome['status']; result: Outcome['result']; merged: boolean}[] = [
    {name: 'built the pick, merged', facts: merged, status: 'completed', result: 'success', merged: true},
    {name: 'built the pick, not merged', facts: {branch: 'feat/the_ticket', pushed: true, claim: 'complete'}, status: 'failed', result: 'failure', merged: false},
    {
      name: 'declined the pick on the record',
      facts: {declined: 'the_ticket', claim: 'stop', stopReason: 'unclear'},
      status: 'declined',
      result: 'neutral',
      merged: false,
    },
    {
      name: 'took another ticket, merged',
      facts: {...merged, ticket: 'other', branch: 'feat/other'},
      status: 'off-pick',
      result: 'failure',
      merged: true,
    },
    {
      name: 'took another ticket, not merged',
      facts: {ticket: 'other', branch: 'feat/other', pushed: true, claim: 'complete'},
      status: 'off-pick',
      result: 'failure',
      merged: false,
    },
    {
      name: 'took another ticket and declined the pick',
      facts: {ticket: 'other', branch: 'feat/other', declined: 'the_ticket'},
      status: 'off-pick',
      result: 'failure',
      merged: false,
    },
    {
      name: 'declined a ticket that is not the pick',
      facts: {declined: 'other', claim: 'stop', stopReason: 'x'},
      status: 'failed',
      result: 'failure',
      merged: false,
    },
  ];
  for (const r of rows) {
    test(r.name, () => {
      const o = decideOutcome({...nothing, ...r.facts});
      expect(o.status).toBe(r.status);
      expect(o.result).toBe(r.result);
      expect(o.merged).toBe(r.merged);
    });
  }

  test('an off-pick run halts nothing and names both tickets', () => {
    const o = decideOutcome({...nothing, ...merged, ticket: 'other', branch: 'feat/other', declined: 'the_ticket'});
    expect(o.halt).toBeNull();
    expect(o.error).toContain('"other"');
    expect(o.error).toContain('"the_ticket"');
    expect(o.error).toContain('declined');
  });
});

describe('decideOutcome on the verdict of a merged PR (ADR 0010)', () => {
  const rows: {name: string; verdict: RunFacts['verdict']; status: Outcome['status']; result: Outcome['result']}[] = [
    {name: 'merged with a passing verdict', verdict: 'pass', status: 'completed', result: 'success'},
    {name: 'merged with no verdict for its head', verdict: null, status: 'unverified', result: 'failure'},
    {name: 'merged on a block', verdict: 'block', status: 'unverified', result: 'failure'},
    {name: 'merged on an unclear verdict', verdict: 'unclear', status: 'unverified', result: 'failure'},
  ];
  for (const r of rows) {
    test(r.name, () => {
      const o = decideOutcome({...nothing, merged: true, pr: pr('success'), verdict: r.verdict});
      expect(o.status).toBe(r.status);
      expect(o.result).toBe(r.result);
      expect(o.merged).toBe(true);
      expect(o.halt === null).toBe(r.status === 'completed');
    });
  }

  test('an unverified merge is recorded as the unverified event', () => {
    expect(decideOutcome({...nothing, merged: true, pr: pr('success'), verdict: null}).haltKind).toBe('unverified');
  });

  test('a red merge stays merged-red whatever the verdict', () => {
    expect(decideOutcome({...nothing, merged: true, pr: pr('failure', ['gates']), verdict: null}).status).toBe('merged-red');
  });
});
