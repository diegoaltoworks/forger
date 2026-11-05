/**
 * The Claude Code harness: the headless `claude` CLI, with commands installed
 * by its plugin system, so setup writes none of them. `--max-budget-usd` is the harness's own spend cap.
 */

import type {Harness} from '../ports';
import {claudeHooks} from './claude-hooks';

export const claudeHarness: Harness = {
  id: 'claude',
  usage: 'cap',
  spawn({prompt, sessionId, tier, model}) {
    return {
      command: 'claude',
      args: ['--print', '--model', model, '--max-budget-usd', tier.budget.toString(), '--session-id', sessionId, '--dangerously-skip-permissions'],
      input: prompt,
    };
  },
  commandPath: () => null,
  pluginRootVar: 'CLAUDE_PLUGIN_ROOT',
  packageCommand: source => source,
  hooks: claudeHooks,
};
