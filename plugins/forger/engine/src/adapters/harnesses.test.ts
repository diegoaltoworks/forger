import {describe, expect, test} from 'bun:test';

import type {AgentRunOptions} from '../ports';
import {claudeHarness} from './claude';
import {findHarness, HARNESSES} from './harnesses';
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
  test('an unknown id names the available ones', () => expect(() => findHarness('nope')).toThrow('claude, opencode'));
});
