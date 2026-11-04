import {afterEach, describe, expect, spyOn, test} from 'bun:test';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {CommandRunner} from '../ports';
import {main} from './main';

const dirs: string[] = [];
const cwd = process.cwd();
afterEach(() => {
  process.chdir(cwd);
  process.exitCode = 0;
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function project(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-contract-')));
  dirs.push(root);
  mkdirSync(join(root, '.forger'));
  writeFileSync(join(root, '.forger', 'backlog.json'), JSON.stringify({features: {}}));
  writeFileSync(join(root, '.forger', 'workloop.config.json'), JSON.stringify({tracker: {kind: 'local'}}));
  return root;
}

const run: CommandRunner = cmd => {
  if (cmd.startsWith('git diff --name-only')) return 'src/a.ts\nsrc/b.ts\n';
  throw new Error(`unexpected: ${cmd}`);
};

async function contract(argv: string[]): Promise<{out: {ok: boolean; problems: string[]; next?: {slot: string; attempt: number; action: string; reason?: string}}; code: number}> {
  const lines: string[] = [];
  const spy = spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
  try {
    await main(['contract', ...argv, '--json'], {run});
  } finally {
    spy.mockRestore();
  }
  const code = Number(process.exitCode ?? 0);
  process.exitCode = 0;
  return {out: JSON.parse(lines.join('\n')), code};
}

describe('contract --slot review', () => {
  const findings = [
    {severity: 'high', file: 'src/a.ts', line: 3, summary: 'leaks', disposition: 'fixed'},
    {severity: 'medium', file: 'src/elsewhere.ts', line: 9, summary: 'odd'},
    {severity: 'medium', file: 'src/b.ts', line: 2, summary: 'odd', disposition: 'declined'},
  ];

  test('a fixture file returns the expected problems, the next step and exit 1', async () => {
    const root = project();
    process.chdir(root);
    writeFileSync(join(root, 'review.json'), JSON.stringify(findings));
    const {out, code} = await contract(['--slot', 'review', '--file', 'review.json']);
    expect(out).toEqual({
      ok: false,
      problems: ['review_findings[1] file src/elsewhere.ts is not in the diff', 'review_findings[1] is medium and has no disposition', 'review_findings[2] is declined without a reason'],
      next: {slot: 'review', attempt: 1, action: 'retry'},
    });
    expect(code).toBe(1);
  });

  test('a good file is ok and exits 0', async () => {
    const root = project();
    process.chdir(root);
    writeFileSync(join(root, 'review.json'), JSON.stringify([findings[0]]));
    const {out, code} = await contract(['--slot', 'review', '--file', 'review.json']);
    expect(out).toEqual({ok: true, problems: []});
    expect(code).toBe(0);
  });

  test('with --ticket each attempt is recorded as an event and the policy follows the attempt', async () => {
    const root = project();
    process.chdir(root);
    writeFileSync(join(root, 'review.json'), 'not json');
    const {out} = await contract(['--slot', 'review', '--file', 'review.json', '--ticket', 'issue-9', '--attempt', '3']);
    expect(out.ok).toBe(false);
    expect(out.next).toEqual({slot: 'review', attempt: 3, action: 'decline', reason: 'unclear'});
    const events = readFileSync(join(root, '.forger', 'events.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(events).toEqual([expect.objectContaining({event: 'contract_attempt', ticket: 'issue-9', reason: expect.stringContaining('review attempt 3: the result is not valid JSON')})]);
  });
});

describe('contract, the loop-validated contracts', () => {
  test('rebase_clean is clean only on status clean', async () => {
    const root = project();
    process.chdir(root);
    writeFileSync(join(root, 'r.json'), JSON.stringify({status: 'conflict', files: ['a']}));
    expect((await contract(['--slot', 'merge_conflicts', '--file', 'r.json'])).out.problems).toEqual(['the rebase is not clean (status "conflict")']);
    writeFileSync(join(root, 'r.json'), JSON.stringify({status: 'clean'}));
    expect((await contract(['--slot', 'merge_conflicts', '--file', 'r.json'])).out.ok).toBe(true);
  });

  test('pr_body keeps the closing line', async () => {
    const root = project();
    process.chdir(root);
    writeFileSync(join(root, 'body.md'), 'Did it\n');
    const bad = await contract(['--slot', 'pr_body', '--file', 'body.md', '--issue', '5']);
    expect(bad.out.problems).toEqual(['the body does not carry "Closes #5" on its own line']);
    writeFileSync(join(root, 'body.md'), 'Did it\n\nCloses #5\n');
    expect((await contract(['--slot', 'pr_body', '--file', 'body.md', '--issue', '5'])).out.ok).toBe(true);
  });
});

describe('contract, bad input', () => {
  test('an unknown slot, a missing file and a missing flag exit 1', async () => {
    const root = project();
    process.chdir(root);
    const errors: string[] = [];
    const spy = spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errors.push(a.join(' ')));
    try {
      await main(['contract', '--slot', 'nope', '--file', 'x'], {run});
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
      await main(['contract', '--slot', 'review', '--file', 'missing.json'], {run});
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
      await main(['contract', '--slot', 'review'], {run});
      expect(process.exitCode).toBe(1);
    } finally {
      spy.mockRestore();
    }
    expect(errors[0]).toContain('no contract for slot "nope"');
    expect(errors[1]).toContain('missing.json does not exist');
    expect(errors[2]).toContain('--slot and --file are required');
  });
});
