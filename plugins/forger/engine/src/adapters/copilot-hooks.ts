/**
 * Copilot's repository hooks: forger's `preToolUse` hook in
 * `.github/hooks/forger.json`. The file is forger's own, so installing writes
 * it whole; the hook command exits 2, which Copilot always treats as a denial.
 */

import {EARLIER_HOOK_LINE, failsClosed} from '../hooks';
import type {HarnessHooks} from '../ports';
import {HOOK_COMMAND} from './claude-hooks';

export const COPILOT_HOOKS = '.github/hooks/forger.json';

export const copilotHooks: HarnessHooks = {
  path: COPILOT_HOOKS,
  installed(settings) {
    try {
      const parsed = JSON.parse(settings ?? '') as {hooks?: {preToolUse?: Array<{bash?: unknown}>}};
      return (parsed.hooks?.preToolUse ?? []).some(h => typeof h.bash === 'string' && HOOK_COMMAND.test(h.bash));
    } catch {
      return false;
    }
  },
  failsClosed(settings) {
    try {
      const parsed = JSON.parse(settings ?? '') as {hooks?: {preToolUse?: Array<{bash?: unknown}>}};
      const commands = (parsed.hooks?.preToolUse ?? []).map(h => h.bash).filter((c): c is string => typeof c === 'string' && HOOK_COMMAND.test(c));
      return commands.length > 0 && commands.every(failsClosed);
    } catch {
      return false;
    }
  },
  install(settings, command) {
    if (copilotHooks.installed(settings) && !(settings as string).includes(JSON.stringify(EARLIER_HOOK_LINE))) return settings as string;
    return JSON.stringify({version: 1, hooks: {preToolUse: [{type: 'command', bash: command, timeoutSec: 30}]}}, null, 2) + '\n';
  },
};
