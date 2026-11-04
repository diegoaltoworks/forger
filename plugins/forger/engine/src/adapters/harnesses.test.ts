import {describe, expect, test} from 'bun:test';

import type {AgentRunOptions} from '../ports';
import {claudeHarness} from './claude';
import {codexHarness} from './codex';
import {copilotHarness} from './copilot';
import {agentFor, findHarness, HARNESSES} from './harnesses';
import {opencodeCommandName, opencodeHarness, stripClaudeFrontmatter} from './opencode';

const opts: AgentRunOptions = {
  prompt: 'do the ticket',
  sessionId: '0123456789abcdef',
  tier: {model: 'standard', budget: 18},
  model: 'sonnet',
  workerCommand: 'forger:auto-ticket',
  cwd: '/p',
  timeoutMinutes: 45,
  killGraceSeconds: 30,
};

describe('spawn', () => {
  test('claude reads the prompt on stdin and caps the spend', () => {
    expect(claudeHarness.spawn(opts)).toEqual({
      command: 'claude',
      args: ['--print', '--model', 'sonnet', '--max-budget-usd', '18', '--session-id', '0123456789abcdef', '--dangerously-skip-permissions'],
      input: 'do the ticket',
    });
  });
  test('opencode runs the worker command with the prompt as its argument', () => {
    expect(opencodeHarness.spawn({...opts, model: 'anthropic/sonnet'})).toEqual({
      command: 'opencode',
      args: ['run', '--auto', '--model', 'anthropic/sonnet', '--command', 'forger-auto-ticket', '--title', 'forger-01234567', 'do the ticket'],
    });
  });
});

describe('install paths', () => {
  test('claude installs commands through its plugin system', () => expect(claudeHarness.commandPath('auto-ticket')).toBeNull());
  test('opencode installs into the project', () => expect(opencodeHarness.commandPath('auto-ticket')).toBe('.opencode/commands/forger-auto-ticket.md'));
  test('the command name has no colon', () => expect(opencodeCommandName('forger:auto-ticket')).toBe('forger-auto-ticket'));
});

describe('packaging', () => {
  const source = '---\ndescription: d\nallowed-tools: Bash(*)\n---\n\nrun bun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts" and $CLAUDE_PLUGIN_ROOT\n';
  test('claude keeps the source as it is', () => expect(claudeHarness.packageCommand(source, '/plug')).toBe(source));
  test('opencode drops the keys it does not read and resolves the plugin root', () => {
    expect(opencodeHarness.packageCommand(source, '/plug')).toBe('---\ndescription: d\n---\n\nrun bun "/plug/bin/work.ts" and /plug\n');
  });
  test('text without frontmatter is unchanged', () => expect(stripClaudeFrontmatter('hello')).toBe('hello'));
});

describe('registry', () => {
  test('finds each shipped harness by id', () => {
    for (const h of HARNESSES) expect(findHarness(h.id)).toBe(h);
  });
  test('an unknown id names the available ones', () => expect(() => findHarness('nope')).toThrow('claude, opencode, codex, copilot'));
});

describe('skill harnesses', () => {
  test('codex execs with the prompt on stdin, after the worker skill mention', () => {
    expect(codexHarness.spawn({...opts, model: 'gpt-5'})).toEqual({
      command: 'codex',
      args: ['exec', '--dangerously-bypass-approvals-and-sandbox', '--model', 'gpt-5'],
      input: '$forger-auto-ticket\n\ndo the ticket',
    });
  });
  test('copilot runs the prompt non-interactively with every permission granted', () => {
    expect(copilotHarness.spawn({...opts, model: 'gpt-5'})).toEqual({
      command: 'copilot',
      args: ['-p', '/forger-auto-ticket\n\ndo the ticket', '--model', 'gpt-5', '--allow-all', '--no-ask-user'],
    });
  });
  test('codex installs under .agents/skills', () => expect(codexHarness.commandPath('auto-ticket')).toBe('.agents/skills/forger-auto-ticket/SKILL.md'));
  test('copilot installs under .github/skills', () => expect(copilotHarness.commandPath('auto-ticket')).toBe('.github/skills/forger-auto-ticket/SKILL.md'));
  const source = '---\ndescription: d\nallowed-tools: Bash(*)\n---\n\nrun "${CLAUDE_PLUGIN_ROOT}/bin/work.ts"\n';
  for (const h of [codexHarness, copilotHarness]) {
    test(`${h.id} keeps name and description, drops the rest, resolves the plugin root`, () => {
      expect(h.packageCommand(source, '/plug', 'auto-ticket')).toBe('---\nname: forger-auto-ticket\ndescription: d\n---\n\nrun "/plug/bin/work.ts"\n');
    });
  }
});

import {claudeHooks, HOOK_MATCHER} from './claude-hooks';

describe('hooks', () => {
  const command = 'bun /plug/bin/work.ts hook';
  test('claude installs the hook into empty settings and reads it back', () => {
    const text = claudeHooks.install(null, command);
    expect(JSON.parse(text)).toEqual({hooks: {PreToolUse: [{matcher: HOOK_MATCHER, hooks: [{type: 'command', command}]}]}});
    expect(claudeHooks.installed(text)).toBe(true);
    expect(claudeHooks.installed(null)).toBe(false);
  });
  test('the project settings and hooks already there are kept', () => {
    const before = JSON.stringify({model: 'x', hooks: {PreToolUse: [{matcher: 'Bash', hooks: [{type: 'command', command: 'lint'}]}], Stop: []}});
    const after = JSON.parse(claudeHooks.install(before, command));
    expect(after.model).toBe('x');
    expect(after.hooks.Stop).toEqual([]);
    expect(after.hooks.PreToolUse.map((e: {hooks: Array<{command: string}>}) => e.hooks[0].command)).toEqual(['lint', command]);
  });
  test('settings that already run the hook, by any path, are returned unchanged', () => {
    const own = JSON.stringify({hooks: {PreToolUse: [{matcher: 'Bash', hooks: [{type: 'command', command: 'bun "$CLAUDE_PROJECT_DIR"/plugins/forger/bin/work.ts hook'}]}]}});
    expect(claudeHooks.install(own, command)).toBe(own);
  });
  test('settings that are not JSON are refused, naming the file', () => {
    expect(() => claudeHooks.install('{', command)).toThrow('.claude/settings.json is not valid JSON');
    expect(claudeHooks.installed('{')).toBe(false);
  });
  test('only claude has hooks forger installs', () => {
    expect(HARNESSES.filter(h => h.hooks !== null).map(h => h.id)).toEqual(['claude']);
  });
});

describe('agentFor', () => {
  test('adds its environment under the run\'s own', async () => {
    const h = {...claudeHarness, spawn: () => ({command: 'sh', args: ['-c', 'echo "$A-$B"'], input: ''})};
    const result = await agentFor(h, {A: 'one', B: 'base'}).run({...opts, cwd: '/tmp', env: {B: 'run'}});
    expect(JSON.stringify(result)).toContain('one-run');
  });
});
