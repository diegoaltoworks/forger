import {describe, expect, test} from 'bun:test';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {claudeHarness} from '../../adapters';
import {renderHookPolicy} from '../../hooks';
import {applyWaivers} from '../waivers';
import {hookFindings, WORKER_HOOKS_OPINION} from './hooks';
import {runHooksCheck} from './hooks-check';

const installed = {path: '.claude/settings.json', installed: true};

describe('hookFindings', () => {
  test('the default policy with the hook installed passes', () => {
    expect(hookFindings(renderHookPolicy(), installed)).toEqual([]);
  });

  test('a missing or broken policy is a finding', () => {
    expect(hookFindings(null, installed).map(f => f.rule)).toEqual(['policy-missing']);
    expect(hookFindings('{', installed).map(f => f.rule)).toEqual(['policy-invalid']);
  });

  test('each dropped default rule is a finding a waiver can cover', () => {
    const findings = hookFindings('{"rules": ["merge", "push-base"]}', installed);
    expect(findings.map(f => f.detail)).toEqual(['drops the default rule status-write', 'drops the default rule state-edit', 'drops the default rule leave-worktree']);
    const waiver = {opinion: WORKER_HOOKS_OPINION, path: '.forger/hooks.json', reason: 'this project sets its own statuses', approved_by: 'the owner'};
    expect(applyWaivers(findings, [waiver]).violations).toEqual([]);
  });

  test('settings that do not run the hook are a finding; a harness without hooks is not', () => {
    expect(hookFindings(renderHookPolicy(), {...installed, installed: false}).map(f => f.rule)).toEqual(['hook-missing']);
    expect(hookFindings(renderHookPolicy(), null)).toEqual([]);
  });
});

describe('runHooksCheck', () => {
  test('reads the policy and the claude settings from the project', () => {
    const root = mkdtempSync(join(tmpdir(), 'forger-hooks-'));
    try {
      expect(runHooksCheck(root, claudeHarness).map(f => f.rule)).toEqual(['policy-missing', 'hook-missing']);
      mkdirSync(join(root, '.forger'));
      mkdirSync(join(root, '.claude'));
      writeFileSync(join(root, '.forger', 'hooks.json'), renderHookPolicy());
      writeFileSync(join(root, '.claude', 'settings.json'), claudeHarness.hooks!.install(null, 'bun /p/bin/work.ts hook'));
      expect(runHooksCheck(root, claudeHarness)).toEqual([]);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
});
