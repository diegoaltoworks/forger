import {describe, expect, test} from 'bun:test';

import {toolCalls} from './calls';

describe('toolCalls', () => {
  test('Claude and Codex shapes pass through', () => {
    expect(toolCalls({tool_name: 'Bash', tool_input: {command: 'ls'}})).toEqual([{tool_name: 'Bash', tool_input: {command: 'ls'}}]);
  });
  test('Copilot names and JSON-string arguments are normalised', () => {
    expect(toolCalls({toolName: 'bash', toolArgs: '{"command":"ls"}'})).toEqual([{tool_name: 'Bash', tool_input: {command: 'ls'}}]);
    expect(toolCalls({toolName: 'create', toolArgs: {path: 'a.ts'}})).toEqual([{tool_name: 'Write', tool_input: {path: 'a.ts'}}]);
  });
  test('apply_patch becomes one edit per file', () => {
    const command = '*** Begin Patch\n*** Update File: a.ts\n*** Add File: b.ts\n*** End Patch';
    expect(toolCalls({tool_name: 'apply_patch', tool_input: {command}}).map(c => c.tool_input.file_path)).toEqual(['a.ts', 'b.ts']);
  });
  test('an unreadable payload holds no calls', () => {
    expect(toolCalls({})).toEqual([]);
    expect(toolCalls({toolName: 'bash', toolArgs: 'not json'})).toEqual([]);
  });
});
