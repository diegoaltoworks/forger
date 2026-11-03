import {describe, expect, test} from 'bun:test';

import {type RunFacts, decideOutcome} from './outcome';

const nothing: RunFacts = {
  merged: false,
  pushed: false,
  branch: null,
  ticket: 'the_ticket',
  claim: null,
  stopReason: null,
  exitCode: 0,
  signal: null,
  timedOut: false,
  timeoutMinutes: 45,
  baseBranch: 'main',
  backlogCompleted: false,
  unclean: null,
};

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
});
