import {afterEach, describe, expect, spyOn, test} from 'bun:test';
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import type {CommandRunner} from '../ports';
import {main} from './main';

const dirs: string[] = [];
const startCwd = process.cwd();
afterEach(() => {
  process.chdir(startCwd);
  process.exitCode = 0;
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function project(tracker: Record<string, unknown>): void {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-ticket-')));
  dirs.push(root);
  mkdirSync(join(root, '.forger'));
  writeFileSync(join(root, '.forger', 'backlog.json'), JSON.stringify({features: {}}));
  writeFileSync(join(root, '.forger', 'workloop.config.json'), JSON.stringify({tracker}));
  process.chdir(root);
}

async function ticket(argv: string[], run: CommandRunner): Promise<{out: string; err: string; code: number}> {
  const out: string[] = [];
  const err: string[] = [];
  const log = spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')));
  const error = spyOn(console, 'error').mockImplementation((...a: unknown[]) => void err.push(a.join(' ')));
  try {
    await main(['ticket', ...argv], {run});
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
  const code = Number(process.exitCode ?? 0);
  return {out: out.join('\n'), err: err.join('\n'), code};
}

const github: CommandRunner = cmd => {
  if (cmd.includes('issue view 9')) throw new Error('not found');
  if (cmd.includes('--json number')) return '{"number":4}';
  if (cmd.includes('--json title')) return 'The title\n';
  if (cmd.includes('--json labels,body')) return JSON.stringify({labels: [{name: 'P1'}, {name: 'ready'}], body: 'The text.'});
  throw new Error(`unexpected: ${cmd}`);
};

const adf = (text: string) => ({type: 'doc', version: 1, content: [{type: 'paragraph', content: [{type: 'text', text}]}]});
const jira: CommandRunner = cmd => {
  if (cmd.includes('ABC-9')) return 'not found\n404';
  if (cmd.includes('ABC-4')) return `${JSON.stringify({key: 'ABC-4', fields: {summary: 'The title', description: adf('The text.'), labels: ['P1', 'ready'], status: {statusCategory: {key: 'new'}}}})}\n200`;
  throw new Error(`unexpected: ${cmd}`);
};

describe('work ticket', () => {
  test("work ticket prints a ticket's title, labels and text for every kind, and exits 1 for a ticket that does not exist", async () => {
    const cases: Array<[Record<string, unknown>, CommandRunner]> = [
      [{kind: 'github'}, github],
      [{kind: 'local'}, github],
      [{kind: 'jira', jira: {site: 'https://example.invalid', project: 'ABC'}}, jira],
    ];
    for (const [tracker, run] of cases) {
      project(tracker);
      const text = await ticket(['4'], run);
      expect(text.code).toBe(0);
      expect(text.out).toBe('# The title\n\nLabels: P1, ready\n\nThe text.\n');
      const data = await ticket(['4', '--json'], run);
      expect(JSON.parse(data.out)).toEqual({ticket: 4, title: 'The title', labels: ['P1', 'ready'], body: 'The text.'});
      const missing = await ticket(['9'], run);
      expect(missing.code).toBe(1);
      expect(missing.err).toBe('ticket: ticket 9 does not exist');
      expect(missing.out).toBe('');
      process.exitCode = 0;
    }
  });
});
