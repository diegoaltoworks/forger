/**
 * Claude Code's project hooks: forger's PreToolUse hook in
 * `.claude/settings.json`, the file a worktree checks out with the code, so a
 * worker in its own worktree runs the same hook. Codex reads the same shape
 * from `.codex/hooks.json`. Merging is pure: the project's other settings and
 * hooks are kept as they are.
 */

import {closedHookLine, EARLIER_HOOK_LINE, failsClosed} from '../hooks';
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

/** The commands of the entries that run the hook. */
function hookCommands(settings: Record<string, unknown>): string[] {
  return preToolUse(settings).flatMap(e => (e.hooks ?? []).map(h => h.command)).filter((c): c is string => typeof c === 'string' && HOOK_COMMAND.test(c));
}

/** A settings file whose hook command is exactly the earlier line gets `closed` in its place; any other file is kept as it is. */
function replaceEarlier(parsed: Record<string, unknown>, text: string, closed: string): string {
  let changed = false;
  const entries = preToolUse(parsed).map(e => ({...e, hooks: (e.hooks ?? []).map(h => (h.command === EARLIER_HOOK_LINE ? ((changed = true), {...h, command: closed}) : h))}));
  if (!changed) return text;
  const existing = parsed.hooks as Record<string, unknown>;
  return JSON.stringify({...parsed, hooks: {...existing, PreToolUse: entries}}, null, 2) + '\n';
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
    failsClosed(settings) {
      try {
        const commands = hookCommands(parse(path, settings));
        return commands.length > 0 && commands.every(failsClosed);
      } catch {
        return false;
      }
    },
    install(settings, command) {
      const closed = closedHookLine(command);
      if (hooks.installed(settings)) return replaceEarlier(parse(path, settings), settings as string, closed);
      const parsed = parse(path, settings);
      const existing = (typeof parsed.hooks === 'object' && parsed.hooks !== null ? parsed.hooks : {}) as Record<string, unknown>;
      const entry: HookEntry = {matcher, hooks: [{type: 'command', command: closed}]};
      return JSON.stringify({...parsed, hooks: {...existing, PreToolUse: [...preToolUse(parsed), entry]}}, null, 2) + '\n';
    },
  };
  return hooks;
}

export const claudeHooks: HarnessHooks = preToolUseHooks(CLAUDE_SETTINGS, HOOK_MATCHER);
