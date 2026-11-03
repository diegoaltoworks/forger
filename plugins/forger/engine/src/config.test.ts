import {describe, expect, test} from 'bun:test';

import {DEFAULT_CONFIG, mergeConfig} from './config';

describe('mergeConfig', () => {
  test('empty user config yields the defaults', () => {
    expect(mergeConfig({})).toEqual(DEFAULT_CONFIG);
  });

  test('overrides top-level scalars, keeps other defaults', () => {
    const c = mergeConfig({worker_command: 'do-ticket', base_branch: 'develop', repo: 'foo'});
    expect(c.worker_command).toBe('do-ticket');
    expect(c.base_branch).toBe('develop');
    expect(c.repo).toBe('foo');
    expect(c.limits).toEqual(DEFAULT_CONFIG.limits);
  });

  test('deep-merges limits, keeping unspecified keys', () => {
    const c = mergeConfig({limits: {timeoutMinutes: 10}});
    expect(c.limits.timeoutMinutes).toBe(10);
    expect(c.limits.maxStallIterations).toBe(DEFAULT_CONFIG.limits.maxStallIterations);
    expect(c.limits.maxConsecutiveFailures).toBe(DEFAULT_CONFIG.limits.maxConsecutiveFailures);
  });

  test('deep-merges model_by_priority, keeping the default tier', () => {
    const c = mergeConfig({model_by_priority: {P0: {model: 'opus', budget: 30}}});
    expect(c.model_by_priority.P0).toEqual({model: 'opus', budget: 30});
    expect(c.model_by_priority.default).toEqual(DEFAULT_CONFIG.model_by_priority.default);
  });

  test('supports extra priority tiers alongside the required ones', () => {
    const c = mergeConfig({model_by_priority: {P1: {model: 'haiku', budget: 5}}});
    expect(c.model_by_priority.P1).toEqual({model: 'haiku', budget: 5});
    expect(c.model_by_priority.P0).toEqual(DEFAULT_CONFIG.model_by_priority.P0);
  });

  test('merges paths partially', () => {
    const c = mergeConfig({paths: {state: '.x/state.json'}});
    expect(c.paths.state).toBe('.x/state.json');
    expect(c.paths.backlog).toBe(DEFAULT_CONFIG.paths.backlog);
  });

  test('defaults the tracker to GitHub with the ready-for-agent intake label and nothing ignored', () => {
    expect(DEFAULT_CONFIG.tracker).toEqual({kind: 'github', label: 'ready-for-agent', ignore: []});
  });

  test('merges tracker partially, keeping the default label', () => {
    const c = mergeConfig({tracker: {kind: 'local'}});
    expect(c.tracker.kind).toBe('local');
    expect(c.tracker.label).toBe('ready-for-agent');
  });

  test('the kill grace period has a default and can be overridden alone', () => {
    expect(DEFAULT_CONFIG.limits.killGraceSeconds).toBeGreaterThan(0);
    const c = mergeConfig({limits: {killGraceSeconds: 5}});
    expect(c.limits.killGraceSeconds).toBe(5);
    expect(c.limits.timeoutMinutes).toBe(DEFAULT_CONFIG.limits.timeoutMinutes);
  });

  test('does not mutate the base config', () => {
    mergeConfig({base_branch: 'x', limits: {timeoutMinutes: 1}});
    expect(DEFAULT_CONFIG.base_branch).toBe('main');
    expect(DEFAULT_CONFIG.limits.timeoutMinutes).toBe(45);
  });
});
