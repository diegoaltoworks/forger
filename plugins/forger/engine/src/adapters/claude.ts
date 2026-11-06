/**
 * The Claude Code harness: the headless `claude` CLI, with commands installed
 * by its plugin system, so setup writes none of them. `--max-budget-usd` is the harness's own spend cap.
 */

import type {Harness} from '../ports';
import {claudeHooks} from './claude-hooks';

export const claudeHarness: Harness = {
  id: 'claude',
  credentials: {api_key: ['ANTHROPIC_API_KEY'], subscription: 'CLAUDE_CODE_OAUTH_TOKEN', howTo: 'run `claude setup-token` once on a machine with a browser; it prints a long-lived token to export as CLAUDE_CODE_OAUTH_TOKEN'},
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
