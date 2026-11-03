import {describe, expect, test} from 'bun:test';

import {mkdtempSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {CommandRunner} from '../ports';
import {mergePr, mergeStep} from './merge';
import type {PrFact} from './pr-checks';
import type {VerdictRecord} from './verify-input';

const VIEW = 'gh pr view 9 --json number,state,mergedAt,statusCheckRollup,headRefOid';
const MERGE = 'gh pr merge 9 --squash --delete-branch';

const HEAD = 'abc1234def';

function record(decision: VerdictRecord['decision'], head = HEAD): VerdictRecord {
  return {
    pr: 9,
    head,
    ticket: 'issue-9',
    verifier: 'm',
    decision,
    entries: [
      {criterion: 'c1', verdict: 'met', evidence: []},
      {criterion: 'c2', verdict: decision === 'block' ? 'not_met' : decision === 'unclear' ? 'cannot_tell' : 'met', evidence: []},
    ],
    problems: [],
    at: '2026-01-01T00:00:00Z',
  };
}

function verdictsDir(...records: VerdictRecord[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'forger-verdicts-'));
  records.forEach((r, i) => writeFileSync(join(dir, `pr-${r.pr}-${r.head}${i}.json`), JSON.stringify(r)));
  return dir;
}

type Check = 'SUCCESS' | 'FAILURE' | 'PENDING';

function prJson(state: string, checks: Check[]): string {
  return JSON.stringify({
    number: 9,
    headRefOid: HEAD,
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
const opts = {pr: 9, baseBranch: 'main', verdictsDir: verdictsDir(record('pass')), timeoutMs: 30_000, pollMs: 10_000, sleep: noSleep};

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
    head: 'h1',
    ...over,
  });

  test('an unreadable PR is refused', () => expect(mergeStep(null, [], 0, 1)).toEqual({action: 'refuse', reason: 'cannot read the PR'}));
  test('a closed PR is refused', () => expect(mergeStep(pr({state: 'CLOSED'}), [], 0, 1)).toEqual({action: 'refuse', reason: 'PR #9 is closed'}));
  test('an already merged PR is done', () => expect(mergeStep(pr({state: 'MERGED', merged: true}), [], 0, 1)).toEqual({action: 'done'}));
  test('a repo without CI merges on the local gates', () => expect(mergeStep(pr({checks: 'none'}), [record('pass', 'h1')], 0, 1)).toEqual({action: 'merge'}));
});

describe('mergeStep on the verdict (ADR 0010)', () => {
  const pr: PrFact = {number: 9, state: 'OPEN', merged: false, checks: 'success', checks_ok: true, failing_checks: [], head: HEAD};
  const cases: {name: string; records: VerdictRecord[]; head?: string | null; reason: string | null}[] = [
    {name: 'pass merges', records: [record('pass')], reason: null},
    {name: 'block refuses and names the criteria not met', records: [record('block')], reason: 'the verdict blocks the merge; criteria not met: c2 (not_met)'},
    {name: 'unclear refuses and names the criteria', records: [record('unclear')], reason: 'the verdict is unclear and blocks the merge; criteria not met: c2 (cannot_tell)'},
    {name: 'a missing record refuses', records: [], reason: 'no verdict recorded for the PR head; run verify first'},
    {name: 'a stale record refuses', records: [record('pass', 'older999')], reason: 'the verdict is stale: it was made for an earlier head, not abc1234; run verify again'},
    {name: 'a PR whose head is unknown refuses', records: [record('pass')], head: null, reason: 'cannot tell the PR head, so no verdict can be matched to it'},
  ];
  for (const c of cases) {
    test(c.name, () => {
      const head = c.head === undefined ? HEAD : c.head;
      const step = mergeStep({...pr, head}, c.records, 0, 1);
      expect(step).toEqual(c.reason === null ? {action: 'merge'} : {action: 'refuse', reason: c.reason});
    });
  }

  test('pending checks wait before the verdict is read', () => {
    expect(mergeStep({...pr, checks: 'pending'}, [], 0, 1)).toEqual({action: 'wait'});
  });
});

describe('mergePr on the verdict', () => {
  test('a block never reaches gh pr merge', async () => {
    const {run, calls} = fakeGh([['SUCCESS']]);
    const r = await mergePr(run, {...opts, verdictsDir: verdictsDir(record('block'))});
    expect(r).toMatchObject({merged: false, reason: 'the verdict blocks the merge; criteria not met: c2 (not_met)'});
    expect(calls).not.toContain(MERGE);
  });

  test('no verdicts directory refuses', async () => {
    const {run, calls} = fakeGh([['SUCCESS']]);
    const r = await mergePr(run, {...opts, verdictsDir: join(tmpdir(), 'forger-no-such-dir')});
    expect(r.merged).toBe(false);
    expect(calls).not.toContain(MERGE);
  });
});
