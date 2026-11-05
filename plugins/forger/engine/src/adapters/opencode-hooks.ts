/**
 * OpenCode's guard is a project plugin: `.opencode/plugins/forger-guard.js`,
 * loaded at startup, whose `tool.execute.before` hook asks forger's hook
 * command about each shell and edit call and throws when it refuses, which
 * stops the call. The file is forger's own, so installing writes it whole.
 */

import type {HarnessHooks} from '../ports';
import {HOOK_COMMAND} from './claude-hooks';

export const OPENCODE_PLUGIN = '.opencode/plugins/forger-guard.js';

/** OpenCode's tool ids and argument names, mapped to the names the hook judges. */
const TOOL_NAMES = {bash: 'Bash', edit: 'Edit', write: 'Write', patch: 'Edit', multiedit: 'MultiEdit'};

export function opencodePlugin(command: string): string {
  return `import {spawnSync} from 'child_process';

const TOOLS = ${JSON.stringify(TOOL_NAMES)};
const COMMAND = ${JSON.stringify(command)};

export const ForgerGuard = async ({directory}) => ({
  'tool.execute.before': async (input, output) => {
    const name = TOOLS[input.tool];
    if (!name) return;
    const args = output.args ?? {};
    const tool_input = {...args, ...(args.filePath ? {file_path: args.filePath} : {})};
    const run = spawnSync(COMMAND, {shell: true, cwd: directory, input: JSON.stringify({tool_name: name, tool_input, cwd: directory}), encoding: 'utf-8'});
    if (run.status === 2) throw new Error(run.stderr.trim() || 'forger refused this call');
  },
});
`;
}

export const opencodeHooks: HarnessHooks = {
  path: OPENCODE_PLUGIN,
  installed: settings => settings !== null && settings.includes('ForgerGuard') && HOOK_COMMAND.test(settings.replace(/\\"/g, '"')),
  install: (settings, command) => (opencodeHooks.installed(settings) ? (settings as string) : opencodePlugin(command)),
};
