import {describe, expect, test} from 'bun:test';
import {mkdtempSync, readdirSync, readFileSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {findHarness, guardRefusal, HARNESSES} from './harnesses';
import {HOOK_COMMAND_LINE} from '../packs';
import {opencodePlugin} from './opencode-hooks';

const command = 'bun /p/bin/work.ts hook';
const ADRS = join(import.meta.dir, '../../../../../docs/adr');

describe('the guard', () => {
  test('each harness gets the guard rules in its own mechanism', () => {
    const paths: Record<string, string> = {claude: '.claude/settings.json', opencode: '.opencode/plugins/forger-guard.js', codex: '.codex/hooks.json', copilot: '.github/hooks/forger.json'};
    for (const id of ['claude', 'opencode', 'codex', 'copilot']) {
      const hooks = findHarness(id).hooks!;
      expect(hooks.path).toBe(paths[id]);
      expect(hooks.installed(null)).toBe(false);
      const text = hooks.install(null, command);
      expect(text).toContain(command);
      expect(hooks.installed(text)).toBe(true);
      expect(hooks.install(text, command)).toBe(text);
    }
    expect(JSON.parse(findHarness('codex').hooks!.install(null, command)).hooks.PreToolUse[0].matcher).toContain('apply_patch');
    expect(JSON.parse(findHarness('copilot').hooks!.install(null, command)).hooks.preToolUse[0]).toMatchObject({type: 'command', bash: command});
  });

  test('the opencode plugin throws when the hook exits 2', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forger-guard-'));
    const plugin = join(dir, 'guard.mjs');
    writeFileSync(plugin, opencodePlugin(`sh -c 'echo refused >&2; exit 2'`));
    const guard = await (await import(plugin)).ForgerGuard({directory: dir});
    await expect(guard['tool.execute.before']({tool: 'bash'}, {args: {command: 'ls'}})).rejects.toThrow('refused');
    await guard['tool.execute.before']({tool: 'read'}, {args: {}});
  });

  test('run refuses an unguarded harness without allow_unguarded', () => {
    const unguarded = {...findHarness('opencode'), id: 'bare', hooks: null};
    expect(guardRefusal(unguarded, false)).toContain('allow_unguarded');
    expect(guardRefusal(unguarded, true)).toBeNull();
    for (const h of HARNESSES) expect(guardRefusal(h, false)).toBeNull();
  });

  test('the harness guard ADR names a mechanism and an https source for each harness', () => {
    const adr = readdirSync(ADRS).find(f => f.startsWith('0018-'))!;
    const text = readFileSync(join(ADRS, adr), 'utf-8');
    for (const h of HARNESSES) {
      const row = text.split('\n').find(l => l.startsWith(`| \`${h.id}\``));
      expect(row).toBeDefined();
      expect(row).toContain(h.hooks!.path);
      expect(row).toMatch(/https:\/\/\S+/);
    }
  });
});

describe('the guard when the hook cannot run', () => {
  /** Loads a plugin whose command is `shell`, in a process environment that holds exactly `role`. */
  async function guardFor(shell: string, role: string | undefined) {
    const dir = mkdtempSync(join(tmpdir(), 'forger-guard-'));
    const plugin = join(dir, `guard-${Math.random().toString(36).slice(2)}.mjs`);
    writeFileSync(plugin, opencodePlugin(shell));
    const before = process.env.FORGER_ROLE;
    if (role === undefined) delete process.env.FORGER_ROLE;
    else process.env.FORGER_ROLE = role;
    const guard = await (await import(plugin)).ForgerGuard({directory: dir});
    const restore = () => (before === undefined ? delete process.env.FORGER_ROLE : (process.env.FORGER_ROLE = before));
    return {call: () => guard['tool.execute.before']({tool: 'bash'}, {args: {command: 'ls'}}) as Promise<void>, restore};
  }

  test('the opencode plugin throws for a worker when the hook cannot run', async () => {
    for (const shell of ['exit 7', `sh -c 'kill -9 $$'`, 'no-such-command-forger-482']) {
      const {call, restore} = await guardFor(shell, 'worker');
      try {
        await expect(call()).rejects.toThrow('forger hook could not run');
      } finally {
        restore();
      }
    }
  });

  test('the opencode plugin warns once outside a worker and lets the call through', async () => {
    const {call, restore} = await guardFor('exit 7', undefined);
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...a: unknown[]) => void warnings.push(a.join(' '));
    try {
      await call();
      await call();
    } finally {
      console.warn = original;
      restore();
    }
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('this session is not guarded');
  });

  test('the hook every harness installs fails closed', () => {
    for (const h of HARNESSES) {
      const hooks = h.hooks!;
      expect(hooks.failsClosed(hooks.install(null, HOOK_COMMAND_LINE))).toBe(true);
      expect(hooks.failsClosed(null)).toBe(false);
    }
    expect(findHarness('claude').hooks!.failsClosed(findHarness('claude').hooks!.install(null, 'bun /p/bin/work.ts hook'))).toBe(true);
  });
});
