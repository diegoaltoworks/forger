/**
 * Copilot's repository hooks: forger's `preToolUse` hook in
 * `.github/hooks/forger.json`. The file is forger's own, so installing writes
 * it whole; the hook command exits 2, which Copilot always treats as a denial.
 */

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
  install(settings, command) {
    if (copilotHooks.installed(settings)) return settings as string;
    return JSON.stringify({version: 1, hooks: {preToolUse: [{type: 'command', bash: command, timeoutSec: 30}]}}, null, 2) + '\n';
  },
};
