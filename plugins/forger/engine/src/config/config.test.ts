import {describe, expect, test} from 'bun:test';

import {DEFAULT_CONFIG, mergeConfig, resolveModel} from './config';

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

  test('skills default to none and merge over the base', () => {
    expect(mergeConfig({}).skills).toEqual({});
    const c = mergeConfig({skills: {review: 'a:b'}}, {...DEFAULT_CONFIG, skills: {diagnose: 'c:d'}});
    expect(c.skills).toEqual({diagnose: 'c:d', review: 'a:b'});
  });
});

describe('resolveModel', () => {
  const models = {fast: 'small-1', standard: 'mid-1', deep: 'big-1'};
  test.each([
    ['fast', 'small-1'],
    ['standard', 'mid-1'],
    ['deep', 'big-1'],
    ['opus', 'opus'],
    ['toString', 'toString'],
    ['', ''],
  ])('%s -> %s', (role, model) => {
    expect(resolveModel(role, models)).toBe(model);
  });

  test('the default tiers are roles that the default map resolves', () => {
    const c = mergeConfig({});
    expect(c.model_by_priority.P0.model).toBe('deep');
    expect(resolveModel(c.model_by_priority.default.model, c.models)).toBe('sonnet');
  });

  test('a project maps a role to its own model id, keeping the other roles', () => {
    const c = mergeConfig({models: {deep: 'big-2'}});
    expect(resolveModel('deep', c.models)).toBe('big-2');
    expect(resolveModel('fast', c.models)).toBe(DEFAULT_CONFIG.models.fast);
  });

  test('an old config naming models in its tiers still resolves to them', () => {
    const c = mergeConfig({model_by_priority: {P0: {model: 'opus', budget: 30}, default: {model: 'sonnet', budget: 9}}});
    expect(resolveModel(c.model_by_priority.P0.model, c.models)).toBe('opus');
    expect(resolveModel(c.model_by_priority.default.model, c.models)).toBe('sonnet');
  });
});

describe('parallelism', () => {
  test('defaults to one worker', () => {
    expect(mergeConfig({}).parallelism).toBe(1);
  });
  test('takes a positive integer', () => {
    expect(mergeConfig({parallelism: 2}).parallelism).toBe(2);
  });
  test('rejects zero, negatives, fractions and non-numbers', () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity, '2', null]) {
      expect(() => mergeConfig({parallelism: bad as unknown as number})).toThrow(/parallelism must be a positive integer/);
    }
  });
});

describe('state', () => {
  test('defaults to the local home and the forger-state branch', () => {
    expect(mergeConfig({}).state).toEqual({home: 'local', branch: 'forger-state'});
  });
  test('takes the branch home and a branch name, keeping the other default', () => {
    expect(mergeConfig({state: {home: 'branch'}}).state).toEqual({home: 'branch', branch: 'forger-state'});
    expect(mergeConfig({state: {branch: 'loop/state'}}).state.branch).toBe('loop/state');
  });
  test('rejects an unknown home', () => {
    expect(() => mergeConfig({state: {home: 'cloud' as 'local'}})).toThrow(/state.home must be/);
  });
  test('rejects an unusable branch name', () => {
    for (const bad of ['', '-x', 'a b', 'a;b', 5]) {
      expect(() => mergeConfig({state: {branch: bad as string}})).toThrow(/state.branch must be/);
    }
  });
});
