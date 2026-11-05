import {afterEach, describe, expect, spyOn, test} from 'bun:test';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {check} from './check';
import type {CommandContext} from './command';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
  process.exitCode = 0;
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'forger-check-cli-'));
  dirs.push(root);
  mkdirSync(join(root, '.forger'));
  return root;
}

/** A tracker that answers `gh issue view` with the given body, or throws when given an error. */
function ctx(root: string, positionals: string[], body: string | Error, json = false, commands: string[] = []): CommandContext {
  const run = (cmd: string): string => {
    commands.push(cmd);
    if (body instanceof Error) throw body;
    return body;
  };
  return {values: {json}, positionals: ['check', ...positionals], projectRoot: root, pluginRoot: root, run: () => run} as unknown as CommandContext;
}

async function capture(c: CommandContext): Promise<{out: string; err: string; code: number}> {
  const log = spyOn(console, 'log').mockImplementation(() => {});
  const error = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await check.run(c);
    return {out: log.mock.calls.map(a => String(a[0])).join('\n'), err: error.mock.calls.map(a => String(a[0])).join('\n'), code: Number(process.exitCode ?? 0)};
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

describe('check ticket', () => {
  test('passes an issue whose every criterion can be checked, reading it from the tracker', async () => {
    const commands: string[] = [];
    const r = await capture(ctx(project(), ['ticket', '42'], '## Acceptance\n- [ ] `bun run check` exits 0\n', false, commands));
    expect(r.code).toBe(0);
    expect(r.out).toBe('#42: every acceptance criterion can be checked');
    expect(commands).toEqual(['gh issue view 42 --json body --jq .body']);
  });

  test('fails an issue with an uncheckable criterion and names it', async () => {
    const r = await capture(ctx(project(), ['ticket', '7'], '## Acceptance\n- [ ] The screen feels nice\n'));
    expect(r.code).toBe(1);
    expect(r.out).toContain('#7: 1 problem(s)');
    expect(r.out).toContain('"The screen feels nice"');
  });

  test('fails an issue with no acceptance criteria, and --json carries the verdict', async () => {
    const r = await capture(ctx(project(), ['ticket', '9'], 'Just a description.', true));
    expect(r.code).toBe(1);
    const out = JSON.parse(r.out) as {issue: number; ok: boolean; problems: string[]; criteria: unknown[]};
    expect(out.issue).toBe(9);
    expect(out.ok).toBe(false);
    expect(out.criteria).toEqual([]);
    expect(out.problems[0]).toContain('no acceptance criteria');
  });

  test('a named UI state from ui.json counts as checkable', async () => {
    const root = project();
    writeFileSync(join(root, '.forger/ui.json'), JSON.stringify({states: [{name: 'empty-cart'}]}));
    const r = await capture(ctx(root, ['ticket', '3'], '## Acceptance\n- [ ] The empty-cart page shows the hint\n'));
    expect(r.code).toBe(0);
  });

  test('a missing or malformed issue number reads nothing and fails', async () => {
    const commands: string[] = [];
    const r = await capture(ctx(project(), ['ticket', 'abc'], '', false, commands));
    expect(r.code).toBe(1);
    expect(r.err).toContain('give the issue number');
    expect(commands).toEqual([]);
  });

  test('an unreadable issue fails with the tracker error', async () => {
    const r = await capture(ctx(project(), ['ticket', '5'], new Error('gh down')));
    expect(r.code).toBe(1);
    expect(r.err).toContain('could not read issue #5: gh down');
  });
});

describe('check subcommands', () => {
  test('an unknown check prints the usage and fails', async () => {
    const r = await capture(ctx(project(), ['nope'], ''));
    expect(r.code).toBe(1);
    expect(r.err).toContain('Usage: check');
  });

  test('coverage --update without a coverage report fails and keeps the baseline', async () => {
    const root = project();
    writeFileSync(join(root, '.forger/coverage-baseline.json'), JSON.stringify({line_coverage: 90}));
    const c = ctx(root, ['coverage'], '');
    (c.values as Record<string, unknown>).update = true;
    const r = await capture(c);
    expect(r.code).toBe(1);
    expect(r.err).not.toBe('');
    expect(JSON.parse(readFileSync(join(root, '.forger/coverage-baseline.json'), 'utf-8'))).toEqual({line_coverage: 90});
  });
});

describe('a single check', () => {
  test('applies .forger/waivers.json as the full check does', async () => {
    const root = project();
    writeFileSync(join(root, 'notes.md'), `A dash ${String.fromCharCode(0x2014)} here.\n`);
    const before = await capture(ctx(root, ['docs'], 'notes.md', true));
    expect(before.code).toBe(1);
    const found = JSON.parse(before.out) as Array<{opinion: string; file: string}>;
    expect(found.length).toBeGreaterThan(0);
    process.exitCode = 0;
    const waivers = [...new Set(found.map(f => f.opinion))].map(opinion => ({opinion, path: 'notes.md', reason: 'test', approved_by: 'the owner'}));
    writeFileSync(join(root, '.forger/waivers.json'), JSON.stringify({waivers}));
    const after = await capture(ctx(root, ['docs'], 'notes.md', true));
    expect(after.code).toBe(0);
    expect(JSON.parse(after.out)).toEqual([]);
  });
});
