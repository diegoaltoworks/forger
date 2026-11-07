import {afterEach, describe, expect, spyOn, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'fs';
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

function project(haltedTicket: string | null): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-decide-')));
  dirs.push(root);
  mkdirSync(join(root, '.forger'));
  writeFileSync(join(root, '.forger', 'backlog.json'), JSON.stringify({features: {}}));
  writeFileSync(join(root, '.forger', 'workloop.config.json'), JSON.stringify({tracker: {kind: 'github'}}));
  if (haltedTicket !== null) {
    writeFileSync(join(root, '.forger', 'HALT'), 'boom');
    const e = {event: 'halted', at: '2030-01-01T00:00:00.000Z', iteration: 1, ticket: haltedTicket, reason: 'boom'};
    writeFileSync(join(root, '.forger', 'events.jsonl'), `${JSON.stringify(e)}\n`);
  }
  process.chdir(root);
  return root;
}

const events = (root: string) => readFileSync(join(root, '.forger', 'events.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));

async function decide(argv: string[], body: string): Promise<{edited: string | null}> {
  let edited: string | null = null;
  const run: CommandRunner = cmd => {
    if (cmd.startsWith('gh issue view')) return body;
    if (cmd.startsWith('gh api user')) return 'the-owner\n';
    if (cmd.startsWith('gh issue edit')) {
      edited = cmd;
      return '';
    }
    return '';
  };
  const log = spyOn(console, 'log').mockImplementation(() => {});
  try {
    await main(['decide', ...argv], {run});
  } finally {
    log.mockRestore();
  }
  return {edited};
}

describe('decide', () => {
  test('decide appends a dated, attributed entry under the ticket\'s Decisions section', async () => {
    project(null);
    const {edited} = await decide(['7', 'use the small one'], '## What\n\nx\n\n## Decisions\n\nnone\n');
    const today = new Date().toISOString().slice(0, 10);
    expect(edited).toContain(`- ${today}, the-owner: use the small one`);
    expect(edited).not.toContain('none');
  });

  test('decide creates the Decisions section when the ticket has none', async () => {
    project(null);
    const {edited} = await decide(['7', 'go'], '## What\n\nx\n');
    expect(edited).toContain('## Decisions');
    expect(edited).toContain('the-owner: go');
  });

  test('decide on the halted ticket clears the halt with that ticket as the cause', async () => {
    const root = project('issue-7');
    await decide(['7', 'go with A'], '## What\n');
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(false);
    expect(events(root).at(-1)).toEqual(expect.objectContaining({event: 'halt_cleared', cause: 7, decision: 'go with A'}));
  });

  test('decide on a ticket the loop is not halted on leaves the loop state alone', async () => {
    const root = project('issue-8');
    const {edited} = await decide(['7', 'go'], '## What\n');
    expect(edited).not.toBeNull();
    expect(existsSync(join(root, '.forger', 'HALT'))).toBe(true);
    expect(events(root)).toHaveLength(1);
  });

  test('decide without a number and text is refused', async () => {
    project(null);
    const err = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const {edited} = await decide(['7'], '');
      expect(edited).toBeNull();
      expect(process.exitCode).toBe(1);
    } finally {
      err.mockRestore();
    }
  });
});
