import {afterEach, describe, expect, spyOn, test} from 'bun:test';
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {main} from './cli';

const dirs: string[] = [];
const startCwd = process.cwd();
afterEach(() => {
  process.chdir(startCwd);
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function projectWith(features: Record<string, unknown>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-')));
  dirs.push(root);
  mkdirSync(join(root, '.claude'));
  writeFileSync(join(root, '.claude', 'backlog.json'), JSON.stringify({features}));
  return root;
}

async function capture(argv: string[]): Promise<string> {
  const lines: string[] = [];
  const spy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.join(' '));
  });
  try {
    await main(argv);
  } finally {
    spy.mockRestore();
  }
  return lines.join('\n');
}

describe('backlog --json', () => {
  test('prints the workable tickets in order, the remaining count and the next pick', async () => {
    process.chdir(
      projectWith({
        blocked: {status: 'not_started', priority: 'P0', depends_on: ['b']},
        b: {status: 'not_started', priority: 'P1'},
        a: {status: 'not_started', priority: 'P0'},
        done: {status: 'completed', priority: 'P0'},
      })
    );
    const out = JSON.parse(await capture(['backlog', '--json']));
    expect(out).toEqual({
      workable: [
        {id: 'a', priority: 'P0'},
        {id: 'b', priority: 'P1'},
      ],
      remaining: 3,
      next: 'a',
    });
  });

  test('an empty backlog reports nothing to do', async () => {
    process.chdir(projectWith({done: {status: 'completed'}}));
    const out = JSON.parse(await capture(['backlog', '--json']));
    expect(out).toEqual({workable: [], remaining: 0, next: null});
  });
});
