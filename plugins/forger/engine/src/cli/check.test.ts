import {afterEach, describe, expect, spyOn, test} from 'bun:test';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {capturing} from '../ports';
import {check} from './check';
import {openTicketsCommand, readOpenTickets} from './open-tickets';
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
function ctx(root: string, positionals: string[], body: string | Error, json = false, commands: string[] = [], others: Array<{number: number; body: string}> = []): CommandContext {
  const run = (cmd: string): string => {
    commands.push(cmd);
    if (body instanceof Error) throw body;
    if (cmd.startsWith('gh api graphql')) {
      return JSON.stringify({data: {repository: {issues: {nodes: others.map(o => ({...o, blockedBy: {nodes: []}}))}}}});
    }
    return body;
  };
  return {values: {json}, positionals: ['check', ...positionals], projectRoot: root, pluginRoot: root, run: () => run, capture: () => capturing(run)} as unknown as CommandContext;
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
  test('check ticket warns and passes when the Guards section is missing', async () => {
    const r = await capture(ctx(project(), ['ticket', '5'], '## Acceptance\n- [ ] `bun run check` exits 0\n'));
    expect(r.code).toBe(0);
    expect(r.out).toContain('warning: has no Guards section');
    const json = JSON.parse((await capture(ctx(project(), ['ticket', '5'], '## Acceptance\n- [ ] `bun run check` exits 0\n', true))).out) as {warnings: string[]};
    expect(json.warnings.filter(w => w.includes('Guards'))).toHaveLength(1);
  });

  test('check ticket refuses an empty Guards section', async () => {
    const r = await capture(ctx(project(), ['ticket', '5'], '## Acceptance\n- [ ] `bun run check` exits 0\n\n## Guards\n\n<!-- fill in -->\n\n## Knock-on\n'));
    expect(r.code).toBe(1);
    expect(r.out).toContain('Guards section is empty');
  });

  test('a filled Guards section passes without a warning', async () => {
    const r = await capture(ctx(project(), ['ticket', '5'], '## Acceptance\n- [ ] `bun run check` exits 0\n\n## Guards\n\nnone\n\n## Placement\n\nnone\n'));
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('warning');
  });

  test('passes an issue whose every criterion can be checked, reading it from the tracker', async () => {
    const commands: string[] = [];
    const r = await capture(ctx(project(), ['ticket', '42'], '## Acceptance\n- [ ] `bun run check` exits 0\n', false, commands));
    expect(r.code).toBe(0);
    expect(r.out).toStartWith('#42: every acceptance criterion can be checked');
    expect(commands[0]).toBe('gh issue view 42 --json body --jq .body');
  });

  test('fails a ticket that shares a Knock-on path with another open ticket and names both', async () => {
    const body = '## Acceptance\n- [ ] `bun run check` exits 0\n\n## Guards\n\nnone\n\n## Knock-on\n\n`src/a.ts`\n';
    const r = await capture(ctx(project(), ['ticket', '5'], body, false, [], [{number: 9, body}]));
    expect(r.code).toBe(1);
    expect(r.out).toContain('#5 and #9 share `src/a.ts`');
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

  test('readOpenTickets passes owner and repo as gh fields, not inside the query text', () => {
    const commands: string[] = [];
    readOpenTickets(cmd => {
      commands.push(cmd);
      return {stdout: JSON.stringify({data: {repository: {issues: {nodes: []}}}}), stderr: '', exitCode: 0};
    }, 'ready-for-agent');
    expect(commands).toEqual([openTicketsCommand('ready-for-agent')]);
    expect(commands[0]).toContain("-F owner='{owner}'");
    expect(commands[0]).toContain("-F repo='{repo}'");
    const query = commands[0].slice(commands[0].indexOf('-f query='));
    expect(query).not.toContain('{owner}');
    expect(query).not.toContain('{repo}');
    expect(query).toContain('repository(owner:$owner,name:$repo)');
  });

  test('a failed comparison prints the gh error once, on its warning line', async () => {
    const run = (cmd: string): string => {
      if (cmd.startsWith('gh api graphql')) throw new Error('gh: Could not resolve to a Repository');
      return '## Acceptance\n- [ ] `bun run check` exits 0\n\n## Guards\n\nnone\n';
    };
    const c = {values: {json: false}, positionals: ['check', 'ticket', '5'], projectRoot: project(), run: () => run, capture: () => capturing(run)} as unknown as CommandContext;
    c.pluginRoot = c.projectRoot;
    const r = await capture(c);
    expect(r.code).toBe(0);
    expect(r.out).toContain('warning: could not compare with the other open tickets: gh: Could not resolve to a Repository');
    expect(r.out.split('Could not resolve').length).toBe(2);
    expect(r.err).not.toContain('Could not resolve');
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

describe('check ticket placement', () => {
  const head = '## Acceptance\n- [ ] `bun run check` exits 0\n\n## Guards\n\nnone\n\n';

  function structured(frozen: string[] = [], baseline: Array<{rule: string; path: string; count: number}> = []): string {
    const root = project();
    writeFileSync(join(root, '.forger', 'structure.json'), JSON.stringify({frozen}));
    if (baseline.length) writeFileSync(join(root, '.forger', 'structure-baseline.json'), JSON.stringify({entries: baseline}));
    return root;
  }

  /** The tracker answers the issue body, an open `structure` ticket list, and the other open tickets. */
  function placed(root: string, body: string, native: number[] = []): CommandContext {
    const run = (cmd: string): string => {
      if (cmd.startsWith('gh issue list')) return '77\n';
      if (cmd.startsWith('gh api graphql')) {
        return JSON.stringify({data: {repository: {issues: {nodes: [{number: 5, body, blockedBy: {nodes: native.map(number => ({number}))}}]}}}});
      }
      return body;
    };
    return {values: {}, positionals: ['check', 'ticket', '5'], projectRoot: root, pluginRoot: root, run: () => run, capture: () => capturing(run)} as unknown as CommandContext;
  }

  const over = [{rule: 'structure.folder-size', path: 'src/big', count: 30}];

  test('check ticket warns and passes when Placement is missing', async () => {
    const r = await capture(placed(structured(), `${head}## Knock-on\n\n`));
    expect(r.code).toBe(0);
    expect(r.out).toContain('warning: has no Placement section');
  });

  test('check ticket refuses a Placement folder recorded over its limit', async () => {
    const r = await capture(placed(structured([], over), `${head}## Placement\n\n\`src/big/new-thing.ts\`\n`));
    expect(r.code).toBe(1);
    expect(r.out).toContain('src/big');
    expect(r.out).toContain('structure.folder-size');
    expect(r.out).toContain('labelled structure');
  });

  test('check ticket refuses a frozen Placement folder', async () => {
    const r = await capture(placed(structured(['src/old']), `${head}## Placement\n\n\`src/old/\`\n`));
    expect(r.code).toBe(1);
    expect(r.out).toContain('structure.frozen-folder');
  });

  test('check ticket accepts a flagged Placement folder when the ticket is blocked by a structure ticket', async () => {
    const body = `${head}## Placement\n\n\`src/big/new-thing.ts\`\n\n## Blocked by\n\n#77\n`;
    expect((await capture(placed(structured([], over), body))).code).toBe(0);
    expect((await capture(placed(structured([], over), `${head}## Placement\n\n\`src/big/x.ts\`\n`, [77]))).code).toBe(0);
  });

  test('check ticket accepts a flagged Placement folder when the ticket moves files out of it', async () => {
    const body = `${head}## What to build\n\nMove the parser files out of src/big into src/parse.\n\n## Placement\n\n\`src/big/\`\n`;
    const r = await capture(placed(structured([], over), body));
    expect(r.code).toBe(0);
  });
});
