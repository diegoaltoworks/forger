/**
 * The tool calls a harness's hook payload holds, in the shape the decisions
 * judge. Claude Code and Codex send `tool_name` and `tool_input`; Copilot
 * sends `toolName` and `toolArgs` (an object or a JSON string) with lower-case
 * tool names; a Codex `apply_patch` names its files inside the patch text, so
 * it becomes one edit per file. Pure.
 */

import type {ToolCall} from './decide';

export interface HookPayload {
  tool_name?: unknown;
  tool_input?: unknown;
  toolName?: unknown;
  toolArgs?: unknown;
}

const NAMES: Record<string, string> = {bash: 'Bash', shell: 'Bash', edit: 'Edit', write: 'Write', create: 'Write', multiedit: 'MultiEdit', str_replace_editor: 'Edit'};

const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;

function objectOf(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return objectOf(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function toolCalls(payload: HookPayload): ToolCall[] {
  const rawName = payload.tool_name ?? payload.toolName;
  const input = objectOf(payload.tool_input ?? payload.toolArgs);
  if (typeof rawName !== 'string' || input === null) return [];
  if (rawName === 'apply_patch') {
    const patch = typeof input.command === 'string' ? input.command : '';
    return [...patch.matchAll(PATCH_FILE)].map(m => ({tool_name: 'Edit', tool_input: {file_path: m[1].trim()}}));
  }
  const name = NAMES[rawName.toLowerCase()] ?? rawName;
  return [{tool_name: name, tool_input: input}];
}
