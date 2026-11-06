/**
 * The OpenCode harness: `opencode run` headless, with commands installed as
 * markdown files in the project's `.opencode/commands/`. OpenCode takes the
 * prompt as an argument, has no spend cap flag, and names a model `provider/model`,
 * so a project using it maps the roles under `models` to such ids.
 *
 * Usage: `run --format json` prints raw JSON events (https://opencode.ai/docs/cli/), and the
 * step-finish part of OpenCode's message schema carries `cost` in USD (the SDK's `StepFinishPart`).
 */

import type {Harness} from '../ports';
import {opencodeHooks} from './opencode-hooks';
import {opencodeSpentUsd, opencodeText} from './usage';

/** A command name OpenCode accepts: the worker command's colon becomes a hyphen. */
export function opencodeCommandName(name: string): string {
  return name.replace(/:/g, '-');
}

/** Drops frontmatter keys OpenCode does not read; its commands take `description` and the body. */
export function stripClaudeFrontmatter(source: string): string {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!match) return source;
  const kept = match[1].split('\n').filter(l => !l.startsWith('allowed-tools:'));
  return `---\n${kept.join('\n')}\n---\n${source.slice(match[0].length)}`;
}

export const opencodeHarness: Harness = {
  id: 'opencode',
  credentials: {api_key: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'], subscription: null, howTo: 'opencode signs in with a cached auth file, not a variable, so only the provider API key works in a sandbox'},
  usage: 'cost',
  spentUsd: opencodeSpentUsd,
  plainText: opencodeText,
  spawn({prompt, model, workerCommand, sessionId}) {
    return {
      command: 'opencode',
      args: ['run', '--format', 'json', '--auto', '--model', model, '--command', opencodeCommandName(workerCommand), '--title', `forger-${sessionId.slice(0, 8)}`, prompt],
    };
  },
  commandPath: name => `.opencode/commands/forger-${name}.md`,
  pluginRootVar: 'FORGER_ROOT',
  packageCommand(source, pluginRoot) {
    return stripClaudeFrontmatter(source).replace(/\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT/g, pluginRoot);
  },
  hooks: opencodeHooks,
};
