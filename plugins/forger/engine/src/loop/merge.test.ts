import {describe, expect, test} from 'bun:test';

import type {CommandRunner} from '../ports';
import {mergePr, mergeStep} from './merge';
import type {PrFact} from './pr-checks';

const VIEW = 'gh pr view 9 --json number,state,mergedAt,statusCheckRollup';
const MERGE = 'gh pr merge 9 --squash --delete-branch';

type Check = 'SUCCESS' | 'FAILURE' | 'PENDING';

function prJson(state: string, checks: Check[]): string {
  return JSON.stringify({
    number: 9,
    state,
    mergedAt: state === 'MERGED' ? '2026-01-01T00:00:00Z' : null,
    statusCheckRollup: checks.map((c, i) => ({
      __typename: 'CheckRun',
      name: `check-${i}`,
      status: c === 'PENDING' ? 'IN_PROGRESS' : 'COMPLETED',
      conclusion: c === 'PENDING' ? '' : c,
    })),
  });
}

/** A gh stub whose PR reads each rollup in turn, the last one sticking; merged once `gh pr merge` ran. */
function fakeGh(rollups: Check[][]): {run: CommandRunner; calls: string[]} {
  const calls: string[] = [];
  let reads = 0;
  let merged = false;
  const run: CommandRunner = cmd => {
    calls.push(cmd);
    if (cmd.includes('.github/workflows')) return '.github/workflows/ci.yml';
    if (cmd === MERGE) {
      merged = true;
      return '';
    }
    if (cmd === VIEW) {
      const checks = rollups[Math.min(reads++, rollups.length - 1)];
      return prJson(merged ? 'MERGED' : 'OPEN', checks);
    }
    return '';
  };
  return {run, calls};
}

const noSleep = async () => {};
const opts = {pr: 9, baseBranch: 'main', timeoutMs: 30_000, pollMs: 10_000, sleep: noSleep};

describe('mergePr', () => {
  test('every check passed: merges by squash', async () => {
    const {run, calls} = fakeGh([['SUCCESS', 'SUCCESS']]);
    const r = await mergePr(run, opts);
    expect(r).toEqual({pr: 9, merged: true, checks: 'success', failing_checks: [], reason: null});
    expect(calls).toContain(MERGE);
  });

  test('one check failed: refuses and names it, never merges', async () => {
    const {run, calls} = fakeGh([['SUCCESS', 'FAILURE']]);
    const r = await mergePr(run, opts);
    expect(r).toEqual({pr: 9, merged: false, checks: 'failure', failing_checks: ['check-1'], reason: 'failing checks: check-1'});
    expect(calls).not.toContain(MERGE);
  });

  test('pending then passed: waits, then merges', async () => {
    const {run, calls} = fakeGh([[], ['PENDING'], ['SUCCESS']]);
    const slept: number[] = [];
    const r = await mergePr(run, {...opts, sleep: async ms => void slept.push(ms)});
    expect(r.merged).toBe(true);
    expect(slept).toEqual([10_000, 10_000]);
    expect(calls.filter(c => c === MERGE)).toHaveLength(1);
  });

  test('still pending at the timeout: refuses, never merges', async () => {
    const {run, calls} = fakeGh([['PENDING']]);
    const r = await mergePr(run, opts);
    expect(r).toMatchObject({merged: false, checks: 'pending', reason: 'checks still pending after 30s'});
    expect(calls).not.toContain(MERGE);
  });

  test('a merge gh did not carry out is reported, not assumed', async () => {
    const calls: string[] = [];
    const run: CommandRunner = cmd => {
      calls.push(cmd);
      return cmd === VIEW ? prJson('OPEN', ['SUCCESS']) : '';
    };
    const r = await mergePr(run, opts);
    expect(r).toMatchObject({merged: false, reason: 'gh pr merge did not merge PR #9'});
  });
});

describe('mergeStep', () => {
  const pr = (over: Partial<PrFact>): PrFact => ({
    number: 9,
    state: 'OPEN',
    merged: false,
    checks: 'success',
    checks_ok: true,
    failing_checks: [],
    ...over,
  });

  test('an unreadable PR is refused', () => expect(mergeStep(null, 0, 1)).toEqual({action: 'refuse', reason: 'cannot read the PR'}));
  test('a closed PR is refused', () => expect(mergeStep(pr({state: 'CLOSED'}), 0, 1)).toEqual({action: 'refuse', reason: 'PR #9 is closed'}));
  test('an already merged PR is done', () => expect(mergeStep(pr({state: 'MERGED', merged: true}), 0, 1)).toEqual({action: 'done'}));
  test('a repo without CI merges on the local gates', () => expect(mergeStep(pr({checks: 'none'}), 0, 1)).toEqual({action: 'merge'}));
});
