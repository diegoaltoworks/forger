/**
 * Codex's project hooks: forger's PreToolUse hook in `.codex/hooks.json`, the
 * same shape Claude Code reads. Codex runs a project hook only once the
 * project's `.codex/` layer is trusted and the hook is reviewed with `/hooks`.
 */

import type {HarnessHooks} from '../ports';
import {preToolUseHooks} from './claude-hooks';

export const CODEX_HOOKS = '.codex/hooks.json';

export const CODEX_MATCHER = 'Bash|apply_patch|Edit|Write';

export const codexHooks: HarnessHooks = preToolUseHooks(CODEX_HOOKS, CODEX_MATCHER);
