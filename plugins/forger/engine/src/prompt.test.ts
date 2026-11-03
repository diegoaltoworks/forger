import {describe, expect, test} from 'bun:test';

import {mergeConfig} from './config';
import {buildPrompt} from './prompt';

describe('buildPrompt', () => {
  test('names the configured worker command and base branch', () => {
    const cfg = mergeConfig({worker_command: 'do-ticket', base_branch: 'develop'});
    const out = buildPrompt(cfg, 3, []);
    expect(out).toContain('Execute the /do-ticket command');
    expect(out).toContain('iteration 3');
    expect(out).toContain('Squash merge onto develop');
  });

  test('includes the gate command when configured', () => {
    const cfg = mergeConfig({gates: 'bun run check'});
    expect(buildPrompt(cfg, 1, [])).toContain('(`bun run check`)');
  });

  test('omits the gate clause when gates is empty', () => {
    const cfg = mergeConfig({gates: ''});
    expect(buildPrompt(cfg, 1, [])).toContain('Run all quality gates\n');
  });

  test('lists completed tasks, or "none"', () => {
    const cfg = mergeConfig({});
    expect(buildPrompt(cfg, 1, [])).toContain('Previous completed tasks: none');
    expect(buildPrompt(cfg, 1, ['a', 'b'])).toContain('Previous completed tasks: a, b');
  });

  test('states the tracker mode and intake label per the config', () => {
    const github = buildPrompt(mergeConfig({tracker: {kind: 'github', label: 'agent-ready'}}), 1, []);
    expect(github).toContain('Tracker is GITHUB');
    expect(github).toContain('`agent-ready`');
    expect(github).toContain('Closes #<issue>');
    expect(buildPrompt(mergeConfig({tracker: {kind: 'local'}}), 1, [])).toContain('Tracker is LOCAL');
    expect(buildPrompt(mergeConfig({tracker: {kind: 'none'}}), 1, [])).toContain('Tracker is NONE');
  });
});
