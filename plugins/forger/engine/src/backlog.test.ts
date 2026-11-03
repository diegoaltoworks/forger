import {describe, expect, test} from 'bun:test';

import {mergeConfig} from './config';
import type {PRD} from './backlog';
import {
  isTicketCompleted,
  nextTaskName,
  remainingTasks,
  tierFor,
  workableCount,
  workableTasks,
} from './backlog';

const config = mergeConfig({repo: 'demo', gates: 'x'});
const noRepoFilter = mergeConfig({});

function prd(features: PRD['features']): PRD {
  return {features};
}

describe('workableTasks', () => {
  test('only not_started tickets, ordered by priority', () => {
    const p = prd({
      c: {status: 'not_started', priority: 'P2'},
      a: {status: 'not_started', priority: 'P0'},
      b: {status: 'not_started', priority: 'P1'},
      done: {status: 'completed', priority: 'P0'},
    });
    expect(workableTasks(p, config).map(t => t.name)).toEqual(['a', 'b', 'c']);
  });

  test('a ticket with an unmet dependency is not workable', () => {
    const p = prd({
      dep: {status: 'not_started', priority: 'P0'},
      blocked: {status: 'not_started', priority: 'P0', depends_on: ['dep']},
    });
    const names = workableTasks(p, config).map(t => t.name);
    expect(names).toContain('dep');
    expect(names).not.toContain('blocked');
  });

  test('a ticket becomes workable once its dependency is completed', () => {
    const p = prd({
      dep: {status: 'completed', priority: 'P0'},
      unblocked: {status: 'not_started', priority: 'P0', depends_on: ['dep']},
    });
    expect(workableTasks(p, config).map(t => t.name)).toEqual(['unblocked']);
  });

  test('foreign-repo tickets are excluded when config.repo is set', () => {
    const p = prd({
      mine: {status: 'not_started', priority: 'P0'},
      theirs: {status: 'not_started', priority: 'P0', repo: 'other'},
      alsoMine: {status: 'not_started', priority: 'P0', repo: 'demo'},
    });
    expect(workableTasks(p, config).map(t => t.name).sort()).toEqual(['alsoMine', 'mine']);
  });

  test('with no repo filter, every repo is included', () => {
    const p = prd({
      a: {status: 'not_started', priority: 'P0'},
      b: {status: 'not_started', priority: 'P0', repo: 'anything'},
    });
    expect(workableTasks(p, noRepoFilter).map(t => t.name).sort()).toEqual(['a', 'b']);
  });

  test('null backlog is empty, not an error', () => {
    expect(workableTasks(null, config)).toEqual([]);
    expect(remainingTasks(null, config)).toBe(0);
    expect(nextTaskName(null, config)).toBeNull();
  });
});

describe('remainingTasks', () => {
  test('counts not_started in this repo regardless of dependencies', () => {
    const p = prd({
      dep: {status: 'not_started', priority: 'P0'},
      blocked: {status: 'not_started', priority: 'P0', depends_on: ['dep']},
      done: {status: 'completed', priority: 'P0'},
      foreign: {status: 'not_started', priority: 'P0', repo: 'other'},
    });
    expect(remainingTasks(p, config)).toBe(2); // dep + blocked; foreign excluded, done excluded
    expect(workableCount(p, config)).toBe(1); // only dep can start now
  });
});

describe('tierFor', () => {
  // Read the tiers off the config rather than restating the numbers. What
  // these tests assert is the multiplier arithmetic and which tier is
  // selected; pinning the budget values here means every future budget
  // change breaks five unrelated tests.
  const p0 = config.model_by_priority.P0;
  const fallback = config.model_by_priority.default;

  test('P0 uses the P0 tier, scaled by effort', () => {
    const p = prd({t: {status: 'not_started', priority: 'P0', effort: 'medium'}});
    expect(tierFor(p, config, 't')).toEqual({
      model: p0.model,
      budget: p0.budget * config.effort_multiplier.medium,
    });
  });

  test('non-P0 priority falls back to the default tier', () => {
    const p = prd({t: {status: 'not_started', priority: 'P2', effort: 'small'}});
    expect(tierFor(p, config, 't')).toEqual({
      model: fallback.model,
      budget: fallback.budget * config.effort_multiplier.small,
    });
  });

  test('unknown effort defaults to a 1x multiplier', () => {
    const p = prd({t: {status: 'not_started', priority: 'P0', effort: 'colossal'}});
    expect(tierFor(p, config, 't')).toEqual({model: p0.model, budget: p0.budget});
  });

  test('large effort applies the large multiplier', () => {
    const p = prd({t: {status: 'not_started', priority: 'P0', effort: 'large'}});
    expect(tierFor(p, config, 't').budget).toBe(
      p0.budget * config.effort_multiplier.large,
    );
  });

  test('a null task name gets the default tier', () => {
    expect(tierFor(prd({}), config, null)).toEqual({
      model: fallback.model,
      budget: fallback.budget,
    });
  });
});

describe('isTicketCompleted', () => {
  test('reflects the backlog status', () => {
    const p = prd({a: {status: 'completed'}, b: {status: 'not_started'}});
    expect(isTicketCompleted(p, 'a')).toBe(true);
    expect(isTicketCompleted(p, 'b')).toBe(false);
    expect(isTicketCompleted(p, 'missing')).toBe(false);
  });
});
