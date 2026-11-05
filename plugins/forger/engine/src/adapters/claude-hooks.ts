/**
 * Claude Code's project hooks: forger's PreToolUse hook in
 * `.claude/settings.json`, the file a worktree checks out with the code, so a
 * worker in its own worktree runs the same hook. Codex reads the same shape
 * from `.codex/hooks.json`. Merging is pure: the project's other settings and
 * hooks are kept as they are.
 */

import type {HarnessHooks} from '../ports';

export const CLAUDE_SETTINGS = '.claude/settings.json';

/** The tools whose calls the hook judges: the shell and the editors. */
export const HOOK_MATCHER = 'Bash|Edit|Write|MultiEdit|NotebookEdit';

export const HOOK_COMMAND = /\bwork\.ts"?\s+hook\b/;

interface HookEntry {
  matcher?: string;
  hooks?: Array<{type?: string; command?: string}>;
}

function parse(path: string, settings: string | null): Record<string, unknown> {
  if (settings === null || settings.trim() === '') return {};
  let raw: unknown;
  try {
    raw = JSON.parse(settings);
  } catch {
    throw new Error(`${path} is not valid JSON; fix it, then run setup again`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${path} must hold a JSON object`);
  return raw as Record<string, unknown>;
}

function preToolUse(settings: Record<string, unknown>): HookEntry[] {
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  const list = hooks?.PreToolUse;
  return Array.isArray(list) ? (list as HookEntry[]) : [];
}

/** A settings file in the `hooks.PreToolUse` shape Claude Code and Codex share. */
export function preToolUseHooks(path: string, matcher: string): HarnessHooks {
  const hooks: HarnessHooks = {
    path,
    installed(settings) {
      try {
        return preToolUse(parse(path, settings)).some(e => (e.hooks ?? []).some(h => typeof h.command === 'string' && HOOK_COMMAND.test(h.command)));
      } catch {
        return false;
      }
    },
    install(settings, command) {
      if (hooks.installed(settings)) return settings as string;
      const parsed = parse(path, settings);
      const existing = (typeof parsed.hooks === 'object' && parsed.hooks !== null ? parsed.hooks : {}) as Record<string, unknown>;
      const entry: HookEntry = {matcher, hooks: [{type: 'command', command}]};
      return JSON.stringify({...parsed, hooks: {...existing, PreToolUse: [...preToolUse(parsed), entry]}}, null, 2) + '\n';
    },
  };
  return hooks;
}

export const claudeHooks: HarnessHooks = preToolUseHooks(CLAUDE_SETTINGS, HOOK_MATCHER);
