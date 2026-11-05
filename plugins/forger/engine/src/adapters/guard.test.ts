import {describe, expect, test} from 'bun:test';
import {mkdtempSync, readdirSync, readFileSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {findHarness, guardRefusal, HARNESSES} from './harnesses';
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
