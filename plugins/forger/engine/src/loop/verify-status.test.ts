import {describe, expect, test} from 'bun:test';

import type {CapturingRunner, CommandResult} from '../ports';
import {
  missingVerifyStatusAnomaly,
  requireVerifyStatus,
  requiresVerifyStatus,
  setVerifyStatus,
  verifyStatusFor,
  withoutVerifyStatus,
  VERIFY_STATUS_CONTEXT,
} from './verify-status';

const ok = (stdout = ''): CommandResult => ({stdout, stderr: '', exitCode: 0});
const http = (code: number, message: string): CommandResult => ({stdout: '', stderr: `gh: ${message} (HTTP ${code})`, exitCode: 1});

/** A fake gh answering by the first matching prefix; every command is recorded. */
function fake(answers: [string, CommandResult][]): {run: CapturingRunner; calls: string[]} {
  const calls: string[] = [];
  const run: CapturingRunner = cmd => {
    calls.push(cmd);
    return answers.find(([prefix]) => cmd.startsWith(prefix))?.[1] ?? ok();
  };
  return {run, calls};
}

const CHECKS = 'gh api repos/{owner}/{repo}/branches/main/protection/required_status_checks';
const PROTECTION = 'gh api repos/{owner}/{repo}/branches/main/protection';

describe('verifyStatusFor', () => {
  test('only a pass is success; block and unclear are failure', () => {
    expect(verifyStatusFor('pass')).toEqual({state: 'success', description: 'verdict: pass'});
    expect(verifyStatusFor('block')).toEqual({state: 'failure', description: 'verdict: block'});
    expect(verifyStatusFor('unclear')).toEqual({state: 'failure', description: 'verdict: unclear'});
  });
});

describe('setVerifyStatus', () => {
  test.each([
    ['pass', 'success'],
    ['block', 'failure'],
    ['unclear', 'failure'],
  ] as const)('a %s verdict sets forger/verify to %s on the head commit', (decision, state) => {
    const f = fake([]);
    expect(setVerifyStatus(f.run, 'abc123', decision)).toEqual({context: VERIFY_STATUS_CONTEXT, state});
    expect(f.calls).toEqual([
      `gh api -X POST repos/{owner}/{repo}/statuses/abc123 -f state=${state} -f context='forger/verify' -f description='verdict: ${decision}'`,
    ]);
  });

  test('a refusal is returned as an error, not thrown', () => {
    const f = fake([['gh api -X POST', http(403, 'Resource not accessible by integration')]]);
    const out = setVerifyStatus(f.run, 'abc123', 'pass');
    expect(out.error).toContain('HTTP 403');
  });
});

describe('withoutVerifyStatus', () => {
  test('drops only the verdict status from a rollup', () => {
    const ci = {__typename: 'CheckRun', name: 'gates', status: 'COMPLETED', conclusion: 'SUCCESS'};
    expect(withoutVerifyStatus([ci, {__typename: 'StatusContext', context: VERIFY_STATUS_CONTEXT, state: 'FAILURE'}])).toEqual([ci]);
    expect(withoutVerifyStatus(null)).toBeNull();
  });
});

describe('requiresVerifyStatus', () => {
  test('reads both the contexts and the checks lists', () => {
    expect(requiresVerifyStatus(fake([[CHECKS, ok(JSON.stringify({contexts: ['gates']}))]]).run, 'main')).toBe(false);
    expect(requiresVerifyStatus(fake([[CHECKS, ok(JSON.stringify({contexts: [VERIFY_STATUS_CONTEXT]}))]]).run, 'main')).toBe(true);
    expect(requiresVerifyStatus(fake([[CHECKS, ok(JSON.stringify({checks: [{context: VERIFY_STATUS_CONTEXT}]}))]]).run, 'main')).toBe(true);
  });

  test('a 404 is an unprotected branch, so the check is not required', () => {
    expect(requiresVerifyStatus(fake([[CHECKS, http(404, 'Branch not protected')]]).run, 'main')).toBe(false);
  });

  test('any other failure is unknown, not an anomaly', () => {
    expect(requiresVerifyStatus(fake([[CHECKS, http(403, 'Upgrade to GitHub Pro')]]).run, 'main')).toBeNull();
    expect(requiresVerifyStatus(fake([[CHECKS, ok('not json')]]).run, 'main')).toBeNull();
  });
});

describe('requireVerifyStatus', () => {
  test('already required: changes nothing', () => {
    const f = fake([[CHECKS, ok(JSON.stringify({contexts: [VERIFY_STATUS_CONTEXT]}))]]);
    expect(requireVerifyStatus(f.run, 'main')).toEqual({required: true, added: false});
    expect(f.calls).toHaveLength(1);
  });

  test('other checks required: appends forger/verify, keeping them', () => {
    const f = fake([[CHECKS, ok(JSON.stringify({contexts: ['gates']}))]]);
    expect(requireVerifyStatus(f.run, 'main')).toEqual({required: true, added: true});
    expect(f.calls[1]).toBe(`gh api -X POST ${CHECKS.slice(7)}/contexts -f 'contexts[]=forger/verify'`);
  });

  test('protected without status checks: enables them with forger/verify', () => {
    const f = fake([[CHECKS, http(404, 'Required status checks not enabled')], [PROTECTION, ok('{}')]]);
    expect(requireVerifyStatus(f.run, 'main')).toEqual({required: true, added: true});
    expect(f.calls[2]).toContain('-X PATCH');
    expect(f.calls[2]).toContain("'contexts[]=forger/verify'");
  });

  test('unprotected: creates a protection requiring forger/verify, for admins too', () => {
    const f = fake([[CHECKS, http(404, 'Branch not protected')], [PROTECTION, http(404, 'Branch not protected')]]);
    expect(requireVerifyStatus(f.run, 'main')).toEqual({required: true, added: true});
    const put = f.calls[2];
    expect(put).toContain('gh api -X PUT');
    expect(put).toContain('"contexts":["forger/verify"]');
    expect(put).toContain('"enforce_admins":true');
  });

  test('a token that cannot read or write the protection is reported, not thrown', () => {
    expect(requireVerifyStatus(fake([[CHECKS, http(403, 'Must have admin rights')]]).run, 'main')).toMatchObject({required: false, added: false, error: expect.stringContaining('admin rights')});
    const f = fake([[CHECKS, ok(JSON.stringify({contexts: []}))], ['gh api -X POST', http(403, 'Must have admin rights')]]);
    expect(requireVerifyStatus(f.run, 'main')).toMatchObject({required: false, error: expect.stringContaining('HTTP 403')});
  });
});

test('the anomaly names the branch and the way to fix it', () => {
  expect(missingVerifyStatusAnomaly('main')).toContain('main does not require the forger/verify check');
  expect(missingVerifyStatusAnomaly('main')).toContain('run setup');
});
