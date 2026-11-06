import {describe, expect, test} from 'bun:test';

import {mergeConfig} from '../config';
import {buildPrompt} from './prompt';

describe('buildPrompt', () => {
  test('names the configured worker command and base branch', () => {
    const cfg = mergeConfig({worker_command: 'do-ticket', base_branch: 'develop'});
    const out = buildPrompt(cfg, 3, [], 'issue-1');
    expect(out).toContain('Execute the /do-ticket command');
    expect(out).toContain('iteration 3');
    expect(out).toContain('Squash merge onto develop');
  });

  test('the worker\'s prompt carries the run\'s deadline', () => {
    const cfg = mergeConfig({limits: {killGraceSeconds: 45}});
    const out = buildPrompt(cfg, 1, [], 'issue-1', false, new Date('2030-01-02T03:04:05.000Z'));
    expect(out).toContain('Deadline: 2030-01-02T03:04:05.000Z');
    expect(out).toContain('FORGER_DEADLINE');
    expect(out).toContain('45s');
    expect(buildPrompt(cfg, 1, [], 'issue-1')).not.toContain('Deadline:');
  });

  test('includes the gate command when configured', () => {
    const cfg = mergeConfig({gates: 'bun run check'});
    expect(buildPrompt(cfg, 1, [], 'issue-1')).toContain('(`bun run check`)');
  });

  test('omits the gate clause when gates is empty', () => {
    const cfg = mergeConfig({gates: ''});
    expect(buildPrompt(cfg, 1, [], 'issue-1')).toContain('Run all quality gates\n');
  });

  test('lists completed tasks, or "none"', () => {
    const cfg = mergeConfig({});
    expect(buildPrompt(cfg, 1, [], 'issue-1')).toContain('Previous completed tasks: none');
    expect(buildPrompt(cfg, 1, ['a', 'b'], 'issue-1')).toContain('Previous completed tasks: a, b');
  });

  test('states the tracker mode and intake label per the config', () => {
    const github = buildPrompt(mergeConfig({tracker: {kind: 'github', label: 'agent-ready'}}), 1, [], 'issue-1');
    expect(github).toContain('Tracker is GITHUB');
    expect(github).toContain('`agent-ready`');
    expect(github).toContain('Closes #<issue>');
    expect(buildPrompt(mergeConfig({tracker: {kind: 'local'}}), 1, [], 'issue-1')).toContain('Tracker is LOCAL');
    expect(buildPrompt(mergeConfig({tracker: {kind: 'none'}}), 1, [], 'issue-1')).toContain('Tracker is NONE');
  });

  test('on GitHub, issues are the backlog and the merge is the status update', () => {
    const out = buildPrompt(mergeConfig({tracker: {kind: 'github', ignore: ['wayfinder:*']}}), 1, [], 'issue-1');
    expect(out).toContain('## GitHub Issues are the backlog');
    expect(out).toContain('`feat/issue-<n>`');
    expect(out).toContain('closed by a merged PR, so do not edit backlog.json');
    expect(out).toContain('Issues labelled `wayfinder:*` are not work');
    expect(out).toContain('ALL changes (code, tests, docs)\n');
    expect(out).not.toContain('source of truth');
  });

  test('names no ignored labels when none are configured', () => {
    expect(buildPrompt(mergeConfig({tracker: {kind: 'github'}}), 1, [], 'issue-1')).not.toContain('are not work');
  });

  test('local and none keep backlog.json as the source of truth', () => {
    for (const kind of ['local', 'none'] as const) {
      const out = buildPrompt(mergeConfig({tracker: {kind}}), 1, [], 'issue-1');
      expect(out).toContain('## backlog.json is the source of truth for status');
      expect(out).toContain('backlog.json updates)');
      expect(out).not.toContain('GitHub Issues are the backlog');
    }
  });

  test('names the pick for every tracker and no longer asks the worker to select', () => {
    for (const kind of ['github', 'local', 'none'] as const) {
      const out = buildPrompt(mergeConfig({tracker: {kind}}), 1, [], 'issue-87');
      expect(out).toContain('Build ticket `issue-87` (the engine\'s pick) and no other');
      expect(out).toContain('build it or decline it');
      expect(out.toLowerCase()).not.toContain('select');
    }
  });

  test('with no workable ticket the prompt says so and names no ticket', () => {
    const out = buildPrompt(mergeConfig({}), 1, [], null);
    expect(out).toContain('There is no workable ticket');
    expect(out).toContain('no actionable tasks');
    expect(out).not.toContain('Build ticket');
  });
});
