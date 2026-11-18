import {describe, expect, test} from 'bun:test';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import {closedHookLine} from '../hooks';
import type {AgentRunOptions} from '../ports';
import {claudeHarness} from './claude';
import {codexHarness} from './codex';
import {copilotHarness} from './copilot';
import {hostSandbox} from './host-sandbox';
import {agentFor, findHarness, HARNESSES} from './harnesses';
import {packageAsSkill} from './skill-package';
import {opencodeCommandName, opencodeHarness, stripClaudeFrontmatter} from './opencode';

const noGit = () => ({stdout: '', stderr: '', exitCode: 1});
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
  test("claude loads the plugin from the engine's root for the session", () => {
    const args = claudeHarness.spawn({...opts, pluginRoot: '/engine/plugin'}).args;
    expect(args.slice(-2)).toEqual(['--plugin-dir', '/engine/plugin']);
  });
  test('only the harness with its own plugin system loads a plugin for the session', () => {
    expect(HARNESSES.filter(h => h.sessionPlugin).map(h => h.id)).toEqual(['claude']);
    for (const h of [opencodeHarness, codexHarness, copilotHarness]) expect(h.spawn({...opts, pluginRoot: '/engine/plugin'}).args).not.toContain('--plugin-dir');
  });
  test('opencode runs the worker command with the prompt as its argument', () => {
    expect(opencodeHarness.spawn({...opts, model: 'anthropic/sonnet'})).toEqual({
      command: 'opencode',
      args: ['run', '--format', 'json', '--auto', '--model', 'anthropic/sonnet', '--command', 'forger-auto-ticket', '--title', 'forger-01234567', 'do the ticket'],
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
  test('claude keeps the source as it is', () => expect(claudeHarness.packageCommand(source)).toBe(source));
  test('opencode drops the keys it does not read and resolves the plugin root', () => {
    expect(opencodeHarness.packageCommand(source)).toBe('---\ndescription: d\n---\n\nrun bun "${FORGER_ROOT:?set FORGER_ROOT to the forger plugin folder}/bin/work.ts" and ${FORGER_ROOT:?set FORGER_ROOT to the forger plugin folder}\n');
  });
  test('text without frontmatter is unchanged', () => expect(stripClaudeFrontmatter('hello')).toBe('hello'));
});

describe('the engine root an engine call names', () => {
  const commandsDir = join(import.meta.dir, '../../../commands');
  const preferred = '${FORGER_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}';
  const call = `bun "${preferred}/bin/work.ts" status`;
  test('every engine call in a command file prefers the engine\'s root', () => {
    const files = readdirSync(commandsDir).filter((f) => f.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const f of files) {
      readFileSync(join(commandsDir, f), 'utf8').split('\n').forEach((line, i) => {
        if (/\$\{?CLAUDE_PLUGIN_ROOT\}?\/bin\/work\.ts/.test(line.replaceAll(preferred, ''))) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
  test('this repository\'s own hook line prefers the engine that runs the loop to the checkout', () => {
    const settings = JSON.parse(readFileSync(join(import.meta.dir, '../../../../../.claude/settings.json'), 'utf8')) as {
      hooks: Record<string, {hooks: {command: string}[]}[]>;
    };
    const commands = Object.values(settings.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)));
    expect(commands.length).toBeGreaterThan(0);
    for (const c of commands) {
      expect(c.indexOf('FORGER_PLUGIN_ROOT')).toBeGreaterThanOrEqual(0);
      expect(c.indexOf('FORGER_PLUGIN_ROOT')).toBeLessThan(c.indexOf('CLAUDE_PROJECT_DIR'));
      expect(c).toContain('forger hook could not run');
    }
  });
  const named = 'bun "${FORGER_PLUGIN_ROOT:-${FORGER_ROOT:?set FORGER_ROOT to the forger plugin folder}}/bin/work.ts" status';
  test('opencode packages an engine call that prefers the engine\'s root', () => {
    expect(opencodeHarness.packageCommand(call)).toBe(named);
  });
  test('a skill harness packages an engine call that prefers the engine\'s root', () => {
    expect(packageAsSkill(call, 'forger-x', 'FORGER_ROOT')).toContain(named);
  });
  test('a packaged engine call names the engine\'s variable, then the harness\'s variable, and no path', () => {
    for (const h of [opencodeHarness, codexHarness, copilotHarness]) {
      const out = h.packageCommand(call, 'x');
      expect(out).toContain('${FORGER_PLUGIN_ROOT:-${FORGER_ROOT:?set FORGER_ROOT to the forger plugin folder}}/bin/work.ts');
      expect(out).not.toContain('CLAUDE_PLUGIN_ROOT');
      expect(out).not.toMatch(/"\//);
    }
  });
  test('no packaged command holds an absolute path', () => {
    for (const f of readdirSync(commandsDir).filter((n) => n.endsWith('.md'))) {
      const src = readFileSync(join(commandsDir, f), 'utf8');
      for (const h of [opencodeHarness, codexHarness, copilotHarness]) {
        const out = h.packageCommand(src, f.slice(0, -3));
        expect(out).not.toContain(join(import.meta.dir, '../../..'));
        expect(out).not.toMatch(/\$\{FORGER_PLUGIN_ROOT:-\//);
      }
    }
  });
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
      args: ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--model', 'gpt-5'],
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
      expect(h.packageCommand(source, 'auto-ticket')).toBe('---\nname: forger-auto-ticket\ndescription: d\n---\n\nrun "${FORGER_ROOT:?set FORGER_ROOT to the forger plugin folder}/bin/work.ts"\n');
    });
  }
});

import {claudeHooks, HOOK_MATCHER} from './claude-hooks';

describe('hooks', () => {
  const command = 'bun /plug/bin/work.ts hook';
  test('claude installs the hook into empty settings and reads it back', () => {
    const text = claudeHooks.install(null, command);
    expect(JSON.parse(text)).toEqual({hooks: {PreToolUse: [{matcher: HOOK_MATCHER, hooks: [{type: 'command', command: closedHookLine(command)}]}]}});
    expect(claudeHooks.installed(text)).toBe(true);
    expect(claudeHooks.installed(null)).toBe(false);
  });
  test('the project settings and hooks already there are kept', () => {
    const before = JSON.stringify({model: 'x', hooks: {PreToolUse: [{matcher: 'Bash', hooks: [{type: 'command', command: 'lint'}]}], Stop: []}});
    const after = JSON.parse(claudeHooks.install(before, command));
    expect(after.model).toBe('x');
    expect(after.hooks.Stop).toEqual([]);
    expect(after.hooks.PreToolUse.map((e: {hooks: Array<{command: string}>}) => e.hooks[0].command)).toEqual(['lint', closedHookLine(command)]);
  });
  test('settings that already run the hook, by any path, are returned unchanged', () => {
    const own = JSON.stringify({hooks: {PreToolUse: [{matcher: 'Bash', hooks: [{type: 'command', command: 'bun "$CLAUDE_PROJECT_DIR"/plugins/forger/bin/work.ts hook'}]}]}});
    expect(claudeHooks.install(own, command)).toBe(own);
  });
  test('settings that are not JSON are refused, naming the file', () => {
    expect(() => claudeHooks.install('{', command)).toThrow('.claude/settings.json is not valid JSON');
    expect(claudeHooks.installed('{')).toBe(false);
  });
  test('every shipped harness has a hook forger installs', () => {
    expect(HARNESSES.filter(h => h.hooks !== null).map(h => h.id)).toEqual(['claude', 'opencode', 'codex', 'copilot']);
  });
});

describe('the run budget', () => {
  const fake = (reports: boolean) => ({
    ...claudeHarness,
    id: 'fake',
    usage: reports ? ('cost' as const) : ('none' as const),
    spawn: () => ({command: 'bash', args: ['-c', 'echo "cost: 1.00"; sleep 0.2; echo "cost: 30.00"; sleep 30']}),
    ...(reports ? {spentUsd: (out: string) => { const m = [...out.matchAll(/cost: ([\d.]+)/g)].pop(); return m ? Number(m[1]) : null; }} : {}),
  });
  const run = (reports: boolean, timeoutMinutes: number) =>
    agentFor(fake(reports), {}, hostSandbox(noGit)).run({...opts, cwd: process.cwd(), timeoutMinutes, killGraceSeconds: 1});

  test('a run that passes its spend limit is stopped and logged, for a harness that reports usage', async () => {
    const r = await run(true, 1);
    expect(r.overSpend).toEqual({limitUsd: 18, spentUsd: 30});
    expect(r.timedOut).toBe(false);
    expect(r.output).toContain('spend limit $18 passed');
  });

  test('a harness with no usage output runs under the timeout alone', async () => {
    const r = await run(false, 0.02);
    expect(r.overSpend ?? null).toBeNull();
    expect(r.timedOut).toBe(true);
  });
});
