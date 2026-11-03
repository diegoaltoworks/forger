import {afterEach, describe, expect, spyOn, test} from 'bun:test';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

import {main} from './cli';
import type {CommandRunner} from './git';

const dirs: string[] = [];
const startCwd = process.cwd();
afterEach(() => {
  process.chdir(startCwd);
  for (const d of dirs.splice(0)) rmSync(d, {recursive: true, force: true});
});

function projectWith(
  features: Record<string, unknown>,
  tracker: Record<string, unknown> = {kind: 'local'}
): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-')));
  dirs.push(root);
  mkdirSync(join(root, '.claude'));
  writeFileSync(join(root, '.claude', 'backlog.json'), JSON.stringify({features}));
  writeFileSync(join(root, '.claude', 'workloop.config.json'), JSON.stringify({tracker}));
  return root;
}

async function capture(argv: string[], run?: CommandRunner): Promise<string> {
  const lines: string[] = [];
  const spy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.join(' '));
  });
  try {
    await main(argv, {run});
  } finally {
    spy.mockRestore();
  }
  return lines.join('\n');
}

describe('status --json', () => {
  test('reports the runner, halt, counters, current ticket and next pick', async () => {
    process.chdir(projectWith({a: {status: 'not_started', priority: 'P0'}}));
    const out = JSON.parse(await capture(['status', '--json']));
    expect(out.runner).toEqual({pid: null, alive: false});
    expect(out.halted).toBe(false);
    expect(out.next_pick).toBe('a');
    expect(out.current_ticket).toBeNull();
    expect(out.counters.max_stall_iterations).toBe(5);
    expect(out.remaining).toBe(1);
  });
});

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

  test('with tracker.kind github, lists tickets from issues, not backlog.json', async () => {
    process.chdir(
      projectWith({from_file: {status: 'not_started', priority: 'P0'}}, {kind: 'github', label: 'go'})
    );
    const issue = (number: number, labels: string[], blockedBy: unknown[] = []) => ({
      number,
      state: 'OPEN',
      labels: {nodes: labels.map(name => ({name}))},
      timelineItems: {nodes: []},
      blockedBy: {nodes: blockedBy},
    });
    const response = JSON.stringify([
      {
        data: {
          repository: {
            issues: {
              nodes: [
                issue(5, ['go', 'P1']),
                issue(6, ['go', 'P0'], [issue(5, ['go'])]),
                issue(7, ['go', 'P2']),
              ],
            },
          },
        },
      },
    ]);
    const calls: string[] = [];
    const run: CommandRunner = cmd => {
      calls.push(cmd);
      return response;
    };
    const out = JSON.parse(await capture(['backlog', '--json'], run));
    expect(out).toEqual({
      workable: [
        {id: 'issue-5', priority: 'P1'},
        {id: 'issue-7', priority: 'P2'},
      ],
      remaining: 3,
      next: 'issue-5',
    });
    expect(calls.every(c => c.startsWith('gh api graphql'))).toBe(true);
  });
});

describe('check docs', () => {
  test('prints file:line and rule and sets a failing exit code on a violation', async () => {
    const root = projectWith({});
    process.chdir(root);
    const out = await capture(['check', 'docs'], () => 'a.md');
    writeFileSync(join(root, 'a.md'), 'x');
    expect(out).toBe('docs check: clean');
    writeFileSync(join(root, 'a.md'), 'bad \u2014');
    const bad = await capture(['check', 'docs', '--json'], () => 'a.md');
    expect(JSON.parse(bad)).toEqual([{file: 'a.md', line: 1, rule: 'non-ascii', detail: 'U+2014'}]);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe('setup --json', () => {
  test('reports each file as written, then as kept on the second run', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forger-cli-setup-')));
    dirs.push(root);
    process.chdir(root);
    const first = JSON.parse(await capture(['setup', '--json', '--gates', 'make test', '--tracker', 'local']));
    expect(first.files.map((f: {action: string}) => f.action)).not.toContain('kept');
    const config = JSON.parse(readFileSync(join(root, '.claude', 'workloop.config.json'), 'utf-8'));
    expect(config.tracker.kind).toBe('local');
    const second = JSON.parse(await capture(['setup', '--json']));
    expect(second.files.map((f: {action: string}) => f.action)).not.toContain('written');
  });
});
